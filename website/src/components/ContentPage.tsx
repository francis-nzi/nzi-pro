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
                <h2>{section.title}</h2>
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
          title="Ready to talk it through?"
          description="Every engagement starts with a short conversation about where you are today and what you need. Get in touch and we'll tell you honestly whether we're the right fit."
        />
        <Link href={ctaHref} className="btn btn-primary">
          {ctaLabel} <ArrowRight size={16} />
        </Link>
      </section>
    </div>
  );
}
