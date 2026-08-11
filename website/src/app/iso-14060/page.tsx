import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/SectionHeading";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema, faqPageSchema, serviceSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "ISO 14060 Explained | The New Draft Net-Zero Standard",
  description:
    "ISO is developing ISO/DIS 14060, a draft international standard for verifiable organisational net-zero claims. Here's what it currently proposes, its draft status, and how Net Zero International helps you prepare.",
  alternates: { canonical: "/iso-14060" },
};

const service = serviceSchema({
  name: "Net Zero Standards Readiness (ISO 14060)",
  serviceType: "Net zero transition planning and standards readiness",
  path: "/iso-14060",
  description:
    "Net-zero transition plans, interim targets and verified emissions data built to align with the direction of the draft ISO 14060 net-zero standard.",
  areaServed: ["United Kingdom"],
});

const breadcrumbs = breadcrumbSchema([{ name: "ISO 14060", path: "/iso-14060" }]);

type TopicItem = {
  q: string;
  a: string;
  faqSchema?: boolean;
  link?: { href: string; label: string };
};

const topics: { name: string; items: TopicItem[] }[] = [
  {
    name: "What ISO 14060 is",
    items: [
      {
        q: "What is ISO 14060?",
        a: "ISO/DIS 14060, “Net Zero Aligned Organizations,” is a draft international standard released for public consultation on 17 June 2026. It's ISO's first proposed global, independently verifiable standard for organisational net-zero transition planning, covering Scope 1, 2 and significant Scope 3 emissions, and it's intended to apply to any type of organisation, not just companies. It builds on ISO's earlier, non-binding IWA 42:2022 Net Zero Guidelines.",
        faqSchema: true,
      },
      {
        q: "Is ISO 14060 finalised yet?",
        a: "No. As of August 2026, it's a Draft International Standard (DIS), out for public consultation from 17 June to 9 September 2026, with a national vote to follow. The requirements described on this page could still change before a final version is published, so treat this as the direction of travel rather than a settled rulebook. We'll update this page as the standard progresses.",
        faqSchema: true,
      },
      {
        q: "What does the current draft actually propose?",
        a: "As drafted, it sets out a staged claims framework: net-zero aspiration, an aligned transition plan, aligned progress, and net-zero achievement. It would require organisations to publish a transition plan within two years of setting a target, set interim science-based targets (the first within five years, then at ten-year intervals), and report and verify progress annually. Carbon credits would not count toward interim or net-zero reduction targets under the current draft — reductions have to be real, in-value-chain reductions.",
        faqSchema: true,
      },
      {
        q: "Isn't “the ISO 14060 family” already a thing? Is this the same?",
        a: "No, and it's a genuinely easy mix-up. Before this draft standard existed, “the ISO 14060 family” was informal shorthand, used across the industry including by ISO's own committee, for the whole cluster of GHG-related standards developed by ISO/TC 207/SC 7: ISO 14064-1, -2 and -3, ISO 14065, ISO 14066, ISO 14067 and ISO 14068. It wasn't a document you could look up and read under that number. ISO/DIS 14060 is the first time “14060” has referred to an actual standard in its own right, and it's specifically about net-zero claims, not a vocabulary document for the wider family.",
        faqSchema: true,
        link: { href: "/iso-14064", label: "See our ISO 14064 page" },
      },
    ],
  },
  {
    name: "Getting ready",
    items: [
      {
        q: "Why should we care about a standard that isn't finalised yet?",
        a: "Because the direction it sets is unlikely to reverse, even if details change before publication. The same organisations pushing for credible net-zero claims — investors, large customers, regulators — are the ones this standard is designed to satisfy. Building toward its likely shape now, with a real transition plan, interim targets and verifiable data, puts you ahead rather than reacting once it's published.",
        faqSchema: true,
      },
      {
        q: "What does an organisation need in place to be ready?",
        a: "The same foundations that make any credible net-zero claim stand up: a Scope 1, 2 and 3 inventory built to a recognised standard such as the GHG Protocol, a published transition plan with interim, science-based targets, and data good enough to be independently verified. If you already have a Carbon Reduction Plan and a verified GHG inventory, most of the groundwork is already in place.",
        faqSchema: true,
        link: { href: "/carbon-reduction-plans", label: "See our Carbon Reduction Plan support" },
      },
    ],
  },
];

const faqs = faqPageSchema(
  "/iso-14060",
  topics.flatMap((topic) => topic.items).filter((item) => item.faqSchema)
);

export default function Iso14060Page() {
  return (
    <>
      <JsonLd data={service} />
      <JsonLd data={breadcrumbs} />
      <JsonLd data={faqs} />
      <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">Standards</p>
        <h1>ISO 14060: the emerging standard for verifiable net-zero claims.</h1>
        <p className="lead">
          ISO 14060 is a new standard from the International Organization for Standardization,
          currently in draft, that sets out what a credible, verifiable organisational net-zero
          claim actually requires — a staged framework from aspiration through to achievement,
          interim science-based targets, a published transition plan, and independent
          verification. It isn&apos;t finalised yet, but it&apos;s the clearest signal so far of
          where net-zero claims are heading, and it builds directly on the same GHG accounting
          standards, including ISO 14064, that most organisations already use.
        </p>
        <p className="muted">Last updated: August 2026 — draft standard, consultation closes 9 September 2026</p>
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
          title="Built on the same foundations ISO 14060 will expect"
          description="We already build our clients' net-zero work the way this draft standard is heading: a Scope 1, 2 and 3 inventory under the GHG Protocol, a transition plan with credible interim targets, and reduction actions that are real rather than offset-dependent, prepared so they'll stand up to independent verification against ISO 14064. As ISO 14060 moves through consultation toward a final published standard, we track the changes and keep clients' net-zero claims aligned with where it's heading, not just where it started."
        />
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Next step"
          title="Want a net-zero plan that's ready for where the standards are heading?"
        />
        <Link href="/contact" className="btn btn-primary">
          Talk to us about net zero planning <ArrowRight size={16} />
        </Link>

        <div className="related-links">
          <Link href="/iso-14064" className="related-link">ISO 14064</Link>
          <Link href="/ghg-protocol" className="related-link">GHG Protocol</Link>
          <Link href="/carbon-reduction-plans" className="related-link">Carbon Reduction Plans</Link>
          <Link href="/nz-insights-pro" className="related-link">NZ Insights Pro</Link>
          <Link href="/contact" className="related-link">Contact</Link>
        </div>
      </section>
      </div>
    </>
  );
}
