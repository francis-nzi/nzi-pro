import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/SectionHeading";

type RelatedLink = {
  href: string;
  label: string;
};

type ClosingCtaProps = {
  title?: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  relatedLinks?: RelatedLink[];
};

export function ClosingCta({
  title = "Ready to talk it through?",
  description = "Every engagement starts with a short conversation about where you are today and what you need. Get in touch and we'll tell you honestly whether we're the right fit.",
  ctaLabel = "Talk to us",
  ctaHref = "/contact",
  relatedLinks = [],
}: ClosingCtaProps) {
  return (
    <section className="content-section">
      <SectionHeading eyebrow="Next step" title={title} description={description} />
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
  );
}
