import Link from "next/link";
import type { Metadata } from "next";
import { SectionHeading } from "@/components/SectionHeading";
import { JsonLd } from "@/components/JsonLd";
import { ClosingCta } from "@/components/ClosingCta";
import { breadcrumbSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "Carbon Reporting Standards | GHG Protocol, ISO 14064, ISO 14060",
  description:
    "Plain-English guides to the standards behind credible carbon reporting: the GHG Protocol, ISO 14064 verification, and the emerging ISO 14060 net-zero standard.",
  alternates: { canonical: "/standards" },
};

const breadcrumbs = breadcrumbSchema([{ name: "Standards", path: "/standards" }]);

const standardsPages = [
  {
    slug: "ghg-protocol",
    eyebrow: "Foundation",
    title: "GHG Protocol",
    description:
      "The Corporate Standard, Scope 2 Guidance and Scope 3 Standard — the most widely used framework for corporate carbon accounting, and the basis of the inventories we build for every client.",
  },
  {
    slug: "iso-14064",
    eyebrow: "Verification",
    title: "ISO 14064",
    description:
      "Organisation-level GHG inventories, project-level reductions, and the methodology accredited bodies use to verify both. The route to independently assured carbon data.",
  },
  {
    slug: "iso-14060",
    eyebrow: "Emerging",
    title: "ISO 14060",
    description:
      "A new draft international standard, currently in public consultation, for verifiable organisational net-zero claims — transition plans, interim targets, and independent verification.",
  },
];

export default function StandardsPage() {
  return (
    <>
      <JsonLd data={breadcrumbs} />
      <div className="site-wrap">
        <section className="page-hero">
          <p className="eyebrow">Standards</p>
          <h1>The frameworks behind credible carbon reporting, explained.</h1>
          <p className="lead">
            Regulations tell you what you must disclose. Standards tell you how to measure it
            properly, and how to prove it&apos;s correct. We build every client&apos;s emissions
            data against these standards from day one, so it holds up whichever framework or
            regulation it eventually needs to satisfy.
          </p>
        </section>

        <section className="content-section">
          <SectionHeading
            eyebrow="Standards guide"
            title="A dedicated page for each standard"
            description="What each one covers, who uses it, how they relate to one another, and how we apply them."
          />

          <div className="card-grid">
            {standardsPages.map((page) => (
              <Link key={page.slug} href={`/${page.slug}`} className="page-card">
                <p className="eyebrow">{page.eyebrow}</p>
                <h3>{page.title}</h3>
                <p>{page.description}</p>
              </Link>
            ))}
          </div>
        </section>

        <ClosingCta
          title="Not sure which standards apply to you?"
          description="Tell us how you report today, and who you need to satisfy, and we'll tell you plainly which standards matter for your organisation and which don't."
          ctaLabel="Talk to us about standards"
          relatedLinks={[
            { href: "/regulations", label: "Regulations" },
            { href: "/uk-srs-readiness", label: "UK SRS Readiness" },
            { href: "/nz-insights-pro", label: "NZ Insights Pro" },
          ]}
        />
      </div>
    </>
  );
}
