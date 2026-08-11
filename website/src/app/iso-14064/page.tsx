import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/SectionHeading";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema, faqPageSchema, serviceSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "ISO 14064 Explained | GHG Inventories, Projects & Verification",
  description:
    "A plain-English guide to ISO 14064-1, -2 and -3 — organisation-level GHG inventories, project-level reductions, and third-party verification — and how Net Zero International helps you report and get verified.",
  alternates: { canonical: "/iso-14064" },
};

const service = serviceSchema({
  name: "ISO 14064 GHG Accounting and Verification Support",
  serviceType: "Greenhouse gas inventory and verification support",
  path: "/iso-14064",
  description:
    "Support building a GHG Protocol-aligned emissions inventory that stands up to ISO 14064-1 verification, and reporting project-level reductions under ISO 14064-2.",
  areaServed: ["United Kingdom"],
});

const breadcrumbs = breadcrumbSchema([{ name: "ISO 14064", path: "/iso-14064" }]);

type TopicItem = {
  q: string;
  a: string;
  faqSchema?: boolean;
  link?: { href: string; label: string };
};

const topics: { name: string; items: TopicItem[] }[] = [
  {
    name: "The three parts of ISO 14064",
    items: [
      {
        q: "What is ISO 14064-1?",
        a: "ISO 14064-1:2018 is the specification for quantifying and reporting greenhouse gas emissions and removals at the level of a whole organisation. It sets out how to define your organisational and operational boundaries, quantify direct and indirect emissions (including value-chain categories broadly equivalent to Scope 3), and report the result consistently from year to year. It's the ISO equivalent of building a corporate GHG inventory, and it's the part most UK businesses mean when they refer simply to “ISO 14064.”",
        faqSchema: true,
      },
      {
        q: "What is ISO 14064-2?",
        a: "ISO 14064-2:2019 covers project-level accounting: quantifying, monitoring and reporting the emission reductions or removal enhancements delivered by a specific GHG project, such as a renewable energy installation, an efficiency scheme or a carbon removal initiative. It's used by project developers, not by companies reporting their own corporate footprint.",
        faqSchema: true,
      },
      {
        q: "What is ISO 14064-3?",
        a: "ISO 14064-3:2019 sets the requirements for verifying and validating greenhouse gas statements. It's the methodology an accredited verifier follows to check an ISO 14064-1 organisational inventory, or an ISO 14064-2 project claim, and issue a formal verification or validation statement.",
        faqSchema: true,
      },
      {
        q: "Can a company be “ISO 14064 certified”?",
        a: "Not exactly, and it's worth getting the language right. There's no accredited management-system certificate for a whole organisation, the way there is for ISO 14001 or ISO 9001. What an accredited body actually issues is a verification statement covering a specific GHG inventory for a specific reporting year, following the ISO 14064-3 methodology. The precise, defensible claim is “verified to ISO 14064-1” for a given year, not an ongoing “ISO 14064 certified” status.",
        faqSchema: true,
      },
    ],
  },
  {
    name: "ISO 14064 vs the GHG Protocol",
    items: [
      {
        q: "How does ISO 14064-1 compare to the GHG Protocol Corporate Standard?",
        a: "They're closely aligned, complementary frameworks rather than competitors — both use boundary-setting, scopes and categories, and similar quality principles of relevance, completeness, consistency, transparency and accuracy. The main practical difference is that ISO 14064-1 uses “direct” and “indirect” emissions categories rather than the GHG Protocol's Scope 1, 2 and 3 language, and it doesn't address avoided emissions the way the GHG Protocol does. In practice, most organisations build their inventory to GHG Protocol scope categories and then have it verified against ISO 14064-1 and -3, using both together rather than choosing one over the other.",
        faqSchema: true,
        link: { href: "/ghg-protocol", label: "See our GHG Protocol page" },
      },
      {
        q: "Which one do I need — the GHG Protocol or ISO 14064?",
        a: "For voluntary corporate reporting, such as CDP disclosures, SBTi targets or most sustainability reports, the GHG Protocol is the dominant, most widely used framework. When you need independent, accredited third-party verification of your numbers, for a customer, lender, tender or your own assurance, ISO 14064-1 and -3 are the standards that verification is actually performed against. Many organisations we work with need both: a GHG Protocol-aligned inventory that also stands up to ISO 14064 verification.",
        faqSchema: true,
      },
      {
        q: "Are ISO 14064 and the GHG Protocol about to merge?",
        a: "There's a live move in that direction, worth knowing about even though it doesn't change anything for your reporting today. In September 2025, ISO and the GHG Protocol's publishers, WRI and WBCSD, announced a partnership to eliminate duplication between the two frameworks and produce a single, unified corporate GHG accounting standard, with a public consultation on the combined draft planned for 2027 and a final joint standard targeted for late 2028. Nothing is finalised yet, and the current standards remain fully in force in the meantime — we'll update this page as the process moves forward.",
        faqSchema: true,
      },
    ],
  },
  {
    name: "Verification, and who's involved",
    items: [
      {
        q: "Who actually verifies a GHG inventory against ISO 14064?",
        a: "Accredited verification bodies, such as Bureau Veritas, LRQA and RINA, carry out the verification. The bodies themselves are accredited to ISO 14065, which sets requirements for the competence, impartiality and consistency of the verifying organisation, and the individual auditors follow competence requirements under ISO 14066. Together, ISO 14064-3, 14065 and 14066 form the assurance backbone behind a credible “verified to ISO 14064” statement.",
        faqSchema: true,
      },
      {
        q: "Do I need my inventory verified?",
        a: "Not always, but it's increasingly expected. Verification isn't mandated by the standard itself, but it's often required by external programmes such as CDP or SBTi, by public sector procurement, or simply by customers and lenders who want independent assurance rather than a self-reported number. We help you decide whether formal verification is worth it for your organisation, and prepare an inventory that will stand up to it if you do.",
        faqSchema: true,
      },
    ],
  },
];

const faqs = faqPageSchema(
  "/iso-14064",
  topics.flatMap((topic) => topic.items).filter((item) => item.faqSchema)
);

export default function Iso14064Page() {
  return (
    <>
      <JsonLd data={service} />
      <JsonLd data={breadcrumbs} />
      <JsonLd data={faqs} />
      <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">Standards</p>
        <h1>ISO 14064, explained in plain English.</h1>
        <p className="lead">
          ISO 14064 is a family of three international standards for measuring, reporting and
          verifying greenhouse gas emissions. Part 1 covers whole-organisation GHG inventories,
          Part 2 covers emission-reduction or removal projects, and Part 3 sets the method
          independent verifiers use to check both. Together, they're the standard route to a
          credible, third-party-verified carbon footprint — the level of assurance many customers,
          lenders and public sector buyers now expect.
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
          title="A verification-ready GHG inventory, built once"
          description="We build your organisation's GHG inventory under the GHG Protocol's scope categories from the start, using the data quality and boundary-setting principles ISO 14064-1 requires, so it's ready for independent verification without a rebuild if you need one. Our platform, NZ Insights Pro, keeps that inventory consistent year to year, which is exactly what a verifier checks for. If you're delivering a specific reduction or removal project rather than a corporate inventory, we can also help you quantify and report it in the shape ISO 14064-2 expects."
        />
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Next step"
          title="Not sure whether you need a GHG Protocol inventory, an ISO 14064-verified one, or both?"
        />
        <Link href="/contact" className="btn btn-primary">
          Talk to us about GHG accounting <ArrowRight size={16} />
        </Link>

        <div className="related-links">
          <Link href="/ghg-protocol" className="related-link">GHG Protocol</Link>
          <Link href="/iso-14060" className="related-link">ISO 14060</Link>
          <Link href="/carbon-reduction-plans" className="related-link">Carbon Reduction Plans</Link>
          <Link href="/nz-insights-pro" className="related-link">NZ Insights Pro</Link>
          <Link href="/contact" className="related-link">Contact</Link>
        </div>
      </section>
      </div>
    </>
  );
}
