import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/SectionHeading";

type Section = {
  title: string;
  points: string[];
};

type ContentPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  sections?: Section[];
  ctaHref?: string;
  ctaLabel?: string;
};

export function ContentPage({
  eyebrow,
  title,
  description,
  sections = [],
  ctaHref = "/contact",
  ctaLabel = "Talk to us",
}: ContentPageProps) {
  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="lead">{description}</p>
      </section>

      {sections.length > 0 ? (
        <section className="content-section">
          <div className="page-layout">
            {sections.map((section) => (
              <article key={section.title} className="page-card">
                <h3>{section.title}</h3>
                <ul className="stack-list">
                  {section.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="content-section">
        <SectionHeading
          eyebrow="Next step"
          title="Make this page useful in the real world"
          description="Every public page should make the next action obvious."
        />
        <Link href={ctaHref} className="btn btn-primary">
          {ctaLabel} <ArrowRight size={16} />
        </Link>
      </section>
    </div>
  );
}
