import { SectionHeading } from "@/components/SectionHeading";
import { serviceCards } from "@/content/site";

export const metadata = {
  title: "Services",
  description: "Core service areas for the rebuilt NZ Insights Pro site.",
};

export default function ServicesPage() {
  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">Services</p>
        <h1>Explain the offers in a way that converts and can be expanded later.</h1>
        <p className="lead">
          Each service page should answer three questions immediately: what the service is,
          who it is for, and what the next step should be.
        </p>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Service map"
          title="Initial page set"
          description="These are the pages I would launch first so the site feels complete and commercially useful."
        />

        <div className="card-grid">
          {serviceCards.map((item) => (
            <article key={item.title} className="page-card">
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
