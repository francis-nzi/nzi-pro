import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/SectionHeading";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema, faqPageSchema, serviceSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "GHG Protocol Explained | Corporate Carbon Accounting Standard",
  description:
    "A plain-English guide to the GHG Protocol Corporate Standard, Scope 2 Guidance and Scope 3 Standard — the most widely used framework for corporate carbon accounting — and how Net Zero International applies it.",
  alternates: { canonical: "/ghg-protocol" },
};

const service = serviceSchema({
  name: "GHG Protocol Carbon Accounting Support",
  serviceType: "Corporate greenhouse gas accounting",
  path: "/ghg-protocol",
  description:
    "Emissions inventories built under the GHG Protocol's Corporate Standard, Scope 2 Guidance and Scope 3 Standard, ready to satisfy the reporting regimes built on top of it.",
  areaServed: ["United Kingdom"],
});

const breadcrumbs = breadcrumbSchema([{ name: "GHG Protocol", path: "/ghg-protocol" }]);

type TopicItem = {
  q: string;
  a: string;
  faqSchema?: boolean;
  link?: { href: string; label: string };
};

const topics: { name: string; items: TopicItem[] }[] = [
  {
    name: "What the GHG Protocol covers",
    items: [
      {
        q: "What is the GHG Protocol?",
        a: "The GHG Protocol is a set of standards for measuring and reporting greenhouse gas emissions, developed jointly by the World Resources Institute (WRI) and the World Business Council for Sustainable Development (WBCSD). It's a voluntary framework, not an ISO standard or a government regulation, but it has become the de facto global baseline that most other reporting frameworks and regulations, including SECR, CSRD and the ISSB Standards, build on or reference.",
        faqSchema: true,
      },
      {
        q: "What is the GHG Protocol Corporate Standard?",
        a: "The Corporate Accounting and Reporting Standard, published in 2004, is the foundation of the GHG Protocol. It defines how to set your organisational and operational boundaries and introduces the Scope 1 (direct emissions) and Scope 2 (purchased energy) categories that now underpin almost all corporate carbon reporting.",
        faqSchema: true,
      },
      {
        q: "What is the Scope 2 Guidance?",
        a: "The Scope 2 Guidance, published in 2015, requires companies to report their purchased-electricity emissions two ways: location-based, using average grid emission factors for where the electricity is consumed, and market-based, reflecting contractual instruments such as renewable energy certificates or power purchase agreements. Reporting both gives a fuller picture of your electricity-related emissions and the effect of any renewable purchasing.",
        faqSchema: true,
      },
      {
        q: "What is the Scope 3 Standard?",
        a: "The Corporate Value Chain (Scope 3) Accounting and Reporting Standard, published in 2011, sets out 15 categories of indirect value-chain emissions, from purchased goods and services to business travel, employee commuting, and the use of sold products. For most organisations, Scope 3 is the largest share of their total footprint, and usually the hardest to measure well.",
        faqSchema: true,
        link: { href: "/scope-3", label: "See our Scope 3 support" },
      },
      {
        q: "Is there a GHG Protocol standard for products, not just organisations?",
        a: "Yes. The Product Life Cycle Accounting and Reporting Standard, also published in 2011, covers the carbon footprint of an individual product across its life cycle, rather than a whole organisation's emissions. It's the framework behind product carbon footprinting.",
        faqSchema: true,
        link: { href: "/product-carbon-footprinting", label: "See our product carbon footprinting service" },
      },
    ],
  },
  {
    name: "Where the GHG Protocol is heading",
    items: [
      {
        q: "Is the GHG Protocol being updated?",
        a: "Yes, on more than one track at once, though nothing published today has changed. WRI and WBCSD are running a Scope 3 Standard revision, with a public consultation draft expected in 2026 and a final revised standard targeted for late 2027. Separately, in September 2025, ISO and the GHG Protocol announced a partnership to eliminate duplication between the GHG Protocol and ISO 14064-1, aiming for a single consolidated corporate standard, with public consultation planned for 2027 and target publication in late 2028. The current Corporate Standard, Scope 2 Guidance and Scope 3 Standard remain fully in force while this plays out — we track the process and will flag anything that changes what you need to do.",
        faqSchema: true,
        link: { href: "/iso-14064", label: "See how this compares to ISO 14064" },
      },
      {
        q: "Do I need to be “GHG Protocol certified”?",
        a: "No such certification exists — the GHG Protocol is a reporting framework, not an accreditation scheme. What matters is whether your inventory is built correctly against its principles, and whether you want that inventory independently verified, which is typically done against ISO 14064-1 and -3 rather than the GHG Protocol itself.",
        faqSchema: true,
      },
    ],
  },
];

const faqs = faqPageSchema(
  "/ghg-protocol",
  topics.flatMap((topic) => topic.items).filter((item) => item.faqSchema)
);

export default function GhgProtocolPage() {
  return (
    <>
      <JsonLd data={service} />
      <JsonLd data={breadcrumbs} />
      <JsonLd data={faqs} />
      <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">Standards</p>
        <h1>The GHG Protocol, explained in plain English.</h1>
        <p className="lead">
          The GHG Protocol is the world&apos;s most widely used framework for measuring and
          reporting corporate greenhouse gas emissions. Published by the World Resources Institute
          (WRI) and the World Business Council for Sustainable Development (WBCSD), it's the
          standard behind the Scope 1, 2 and 3 language used across CDP, SBTi targets, and most
          corporate sustainability reporting, including the reports we build for our clients.
        </p>
        <p className="muted">Last updated: August 2026</p>
      </section>

      {topics.map((topic) => (
        <section className="content-section" key={topic.name}>
          <SectionHeading eyebrow="Guide" title={topic.name} />
          <div className="page-layout">
            {topic.items.map((item) => (
              <article key={item.q} className="page-card">
                <h3>{item.q}</h3>
                <p>{item.a}</p>
                {item.link ? (
                  <Link href={item.link.href} className="inline-cta">
                    {item.link.label} <ArrowRight size={15} />
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="content-section">
        <SectionHeading
          eyebrow="How we help"
          title="One inventory, built to the standard everything else references"
          description="We build every client's emissions inventory under the GHG Protocol's scope categories — Scope 1, 2 (both location- and market-based) and Scope 3 across the relevant categories — because it's the common language nearly every other framework you'll encounter, from SECR to CSRD to the UK SRS, is built on or references. That means one properly built inventory can serve multiple reporting obligations, rather than starting from scratch for each one. Where you also need independent verification, we prepare that same inventory to stand up to ISO 14064."
        />
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Next step"
          title="Ready to build a GHG Protocol-aligned inventory that works for every framework you report under?"
        />
        <Link href="/contact" className="btn btn-primary">
          Talk to us about carbon accounting <ArrowRight size={16} />
        </Link>

        <div className="related-links">
          <Link href="/iso-14064" className="related-link">ISO 14064</Link>
          <Link href="/scope-3" className="related-link">Scope 3</Link>
          <Link href="/product-carbon-footprinting" className="related-link">Product Carbon Footprinting</Link>
          <Link href="/nz-insights-pro" className="related-link">NZ Insights Pro</Link>
          <Link href="/contact" className="related-link">Contact</Link>
        </div>
      </section>
      </div>
    </>
  );
}
