import { ClosingCta } from "@/components/ClosingCta";

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
  nextStepTitle,
  nextStepDescription,
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

      <ClosingCta
        title={nextStepTitle}
        description={nextStepDescription}
        ctaLabel={ctaLabel}
        ctaHref={ctaHref}
        relatedLinks={relatedLinks}
      />
    </div>
  );
}
