import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { SectionHeading } from "@/components/SectionHeading";
import { aiPrinciples, buildPhases, homeStats, serviceCards } from "@/content/site";

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="site-wrap hero-grid">
          <div>
            <p className="eyebrow">Net Zero International</p>
            <h1>Build the public site for humans, search, and AI agents.</h1>
            <p className="hero-copy">
              We are not just refreshing pages. We are rebuilding the website as a structured,
              server-rendered, content-first platform that can explain your services clearly today
              and plug into live systems tomorrow.
            </p>

            <div className="hero-actions">
              <Link href="/contact" className="btn btn-primary">
                Start the rebuild <ArrowRight size={16} />
              </Link>
              <Link href="/ai-era" className="btn btn-ghost">
                Why AI-era matters <Sparkles size={16} />
              </Link>
            </div>
          </div>

          <aside className="hero-panel">
            <div className="hero-panel-card">
              <div className="panel-note">
                <strong>What this first release does</strong>
                <p>
                  Establishes a strong visual system, answer-first pages, and a content model that
                  can scale into CMS, CRM, booking, and portal integrations.
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
          <div className="stats-grid">
            {[
              "Same Render environment, separate web service",
              "Structured pages instead of fragmented WordPress templates",
              "Built to support future data, not just present-day copy",
              "Fast server rendering with clear schema and metadata",
            ].map((item) => (
              <article key={item} className="stat-card">
                <span>Principle</span>
                <strong>{item}</strong>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="content-section">
        <div className="site-wrap">
          <SectionHeading
            eyebrow="AI era"
            title="What the rebuild needs to get right"
            description="The point is not to chase novelty. It is to make the website easier for people, search engines, and assistants to understand, trust, and act on."
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
            eyebrow="Services"
            title="A site structure that can grow with the business"
            description="Start with the core offers, then add the supporting pages that make those offers discoverable and explain them properly."
          />

          <div className="card-grid">
            {serviceCards.slice(0, 6).map((item) => (
              <article key={item.title} className="page-card">
                <h3>{item.title}</h3>
                <p>{item.summary}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="content-section">
        <div className="site-wrap">
          <SectionHeading
            eyebrow="Build plan"
            title="The sequence I would use"
            description="This keeps the work focused: establish the system first, deliver the core pages second, then wire in live data only where it adds value."
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
    </>
  );
}
