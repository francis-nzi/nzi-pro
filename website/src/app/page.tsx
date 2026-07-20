import Link from "next/link";
import { ArrowRight, BookOpenText } from "lucide-react";
import { SectionHeading } from "@/components/SectionHeading";
import { aiPrinciples, buildPhases, homeStats, serviceCards, servicePages } from "@/content/site";

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="site-wrap hero-grid">
          <div>
            <p className="eyebrow">Professional Net Zero support</p>
            <h1>Measure, report and reduce emissions with a specialist consultancy.</h1>
            <p className="hero-copy">
              Net Zero International supports organisations with carbon accounting and reporting,
              carbon reduction plans, Scope 3 supply-chain work, workshops, and CPD accredited
              training.
            </p>

            <div className="hero-actions">
              <Link href="/services" className="btn btn-primary">
                Explore services <ArrowRight size={16} />
              </Link>
              <Link href="/contact" className="btn btn-primary">
                Talk to us <ArrowRight size={16} />
              </Link>
            </div>
          </div>

          <aside className="hero-panel">
            <div className="hero-panel-card">
              <div className="panel-note">
                <strong>Core services</strong>
                <p>
                  The public site now points visitors to the real business offerings instead of
                  internal notes.
                </p>
              </div>

              <div className="metric-strip">
                {homeStats.map((item) => (
                  <div className="metric" key={item.label}>
                    <div>
                      <strong>{item.value}</strong>
                      <span>{item.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="content-section">
        <div className="site-wrap">
          <SectionHeading
            eyebrow="Core offer"
            title="The services that sit at the centre of the business"
            description="These are the commercial entry points we should make very easy to find."
          />

          <div className="card-grid">
            {serviceCards
              .filter((item) => item.href)
              .slice(0, 4)
              .map((item) => (
                <article key={item.title} className="page-card">
                  <h3>{item.title}</h3>
                  <p>{item.summary}</p>
                  <Link href={item.href!} className="inline-cta">
                    Learn more<span className="sr-only"> about {item.title}</span>{" "}
                    <ArrowRight size={15} />
                  </Link>
                </article>
              ))}
          </div>
        </div>
      </section>

      <section className="content-section">
        <div className="site-wrap">
          <SectionHeading
            eyebrow="Why work with us"
            title="Specialist delivery, grounded in the standards that matter"
            description="These are the qualities that should be obvious on the public site."
          />

          <div className="card-grid">
            {aiPrinciples.map((item) => (
              <article key={item.title} className="info-card">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="content-section">
        <div className="site-wrap">
          <SectionHeading
            eyebrow="How we work"
            title="A straightforward delivery model"
            description="Start with the need, measure the right things, then turn the result into something the organisation can use."
          />

          <div className="phase-grid">
            {buildPhases.map((phase, index) => (
              <article key={phase.title} className="phase-card">
                <span className="phase-number">0{index + 1}</span>
                <h3>{phase.title}</h3>
                <ul className="stack-list">
                  {phase.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="content-section">
        <div className="site-wrap">
          <SectionHeading
            eyebrow="Featured pages"
            title="Deeper pages for the services and knowledge layer"
            description="These pages support search, answer questions, and give each service its own proper home."
          />

          <div className="card-grid">
            {servicePages.map((page) => (
              <Link key={page.slug} href={`/${page.slug}`} className="page-card">
                <p className="eyebrow">{page.eyebrow}</p>
                <h3>{page.title}</h3>
                <p>{page.description}</p>
                <span className="inline-cta">
                  Read the page <BookOpenText size={15} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
