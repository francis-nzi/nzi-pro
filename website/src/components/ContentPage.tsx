import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/SectionHeading";

type Section = {
  title: string;
  points?: string[];
  body?: string;
};

type RelatedLink = {
  href: string;
  label: string;
};

type ContentPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  sections?: Section[];
  ctaHref?: string;
  ctaLabel?: string;
  nextStepTitle?: string;
  nextStepDescription?: string;
  relatedLinks?: RelatedLink[];
};

export function ContentPage({
  eyebrow,
  title,
  description,
  sections = [],
  ctaHref = "/contact",
  ctaLabel = "Talk to us",
  nextStepTitle = "Ready to talk it through?",
  nextStepDescription = "Every engagement starts with a short conversation about where you are today and what you need. Get in touch and we'll tell you honestly whether we're the right fit.",
  relatedLinks = [],
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
                {section.body ? (
                  <p>{section.body}</p>
                ) : (
                  <ul className="stack-list">
                    {(section.points ?? []).map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="content-section">
        <SectionHeading eyebrow="Next step" title={nextStepTitle} description={nextStepDescription} />
        <Link href={ctaHref} className="btn btn-primary">
          {ctaLabel} <ArrowRight size={16} />
        </Link>

        {relatedLinks.length > 0 ? (
          <div className="related-links">
            {relatedLinks.map((link) => (
              <Link key={link.href} href={link.href} className="related-link">
                {link.label}
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
