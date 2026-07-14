import { SectionHeading } from "@/components/SectionHeading";

export const metadata = {
  title: "About",
  description: "About Net Zero International and the support we provide to organisations.",
};

export default function AboutPage() {
  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">About</p>
        <h1>Professional Net Zero support.</h1>
        <p className="lead">
          Net Zero International supports organisations to navigate the transition to a
          low-carbon future with clarity, credibility, and confidence.
        </p>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="What we do"
          title="Measure, manage, and reduce carbon emissions"
          description="We work across the public and private sectors with practical, science-aligned support."
        />

        <div className="card-grid">
          <article className="info-card">
            <h3>Carbon accounting and reporting</h3>
            <p>Scopes 1, 2 and 3 emissions measurement, reporting, and evidence-led documentation.</p>
          </article>
          <article className="info-card">
            <h3>Carbon reduction plans</h3>
            <p>Plans for procurement, governance, and delivery, including PPN 006 and NHS Evergreen support.</p>
          </article>
          <article className="info-card">
            <h3>Scope 3 and supply chains</h3>
            <p>Supplier engagement, category prioritisation, and practical help with indirect emissions.</p>
          </article>
        </div>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Why work with us"
          title="A specialist partner with practical delivery"
          description="The goal is not just compliance. It is to help organisations build the understanding and capability to keep moving."
        />

        <div className="page-layout">
          <article className="quote-card">
            <blockquote>
              We support clients with expert carbon reporting services, training, workshops, and
              tailored Net Zero strategies that fit the organisation in front of us.
            </blockquote>
          </article>
        </div>
      </section>
    </div>
  );
}
