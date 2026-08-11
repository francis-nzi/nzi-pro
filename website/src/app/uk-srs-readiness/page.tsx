import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/SectionHeading";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema, faqPageSchema, serviceSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "UK SRS Readiness | UK Sustainability Reporting Standards Explained",
  description:
    "A plain-English guide to the UK Sustainability Reporting Standards (UK SRS) — what S1 and S2 require, the FCA's CP26/5 proposals, who's affected, and how Net Zero International assesses and builds your readiness.",
  alternates: { canonical: "/uk-srs-readiness" },
};

const service = serviceSchema({
  name: "UK SRS Readiness Assessment",
  serviceType: "Sustainability reporting readiness assessment",
  path: "/uk-srs-readiness",
  description:
    "A structured readiness assessment against the UK Sustainability Reporting Standards' four pillars — Governance, Strategy, Risk Management, and Metrics & Targets — plus support closing the gaps it finds.",
  areaServed: ["United Kingdom"],
});

const breadcrumbs = breadcrumbSchema([{ name: "UK SRS Readiness", path: "/uk-srs-readiness" }]);

type TopicItem = {
  q: string;
  a: string;
  faqSchema?: boolean;
  link?: { href: string; label: string };
};

const topics: { name: string; items: TopicItem[] }[] = [
  {
    name: "What is UK SRS?",
    items: [
      {
        q: "What are the UK Sustainability Reporting Standards (UK SRS)?",
        a: "UK SRS are two standards — UK SRS S1 (general sustainability-related disclosures) and UK SRS S2 (climate-related disclosures) — published by the Department for Business and Trade on 25 February 2026. They are the UK's endorsed version of the ISSB's IFRS S1 and IFRS S2, first published globally in June 2023, carried across with six UK-specific amendments. In short, they ask a company to explain in its annual report how sustainability affects its business, and to put a number on the climate-related part of that.",
        faqSchema: true,
      },
      {
        q: "Who is responsible for UK SRS — DBT, FRC or FCA?",
        a: "Three bodies play different roles. The Department for Business and Trade (DBT) decided on UK adoption and published the endorsed standards. The Financial Reporting Council (FRC) provides the technical secretariat and is developing assurance standards, but did not itself publish UK SRS. The Financial Conduct Authority (FCA) is the body that can make reporting mandatory, through the UK Listing Rules.",
        faqSchema: true,
      },
      {
        q: "How does UK SRS relate to the ISSB Standards, IFRS S1 and IFRS S2?",
        a: "UK SRS S1 and S2 are the UK's own versions of the global baseline set by the International Sustainability Standards Board (ISSB) in June 2023 — IFRS S1 and IFRS S2 — carried across with six UK-specific amendments. Other jurisdictions, including Australia's ASRS and Singapore's ACRA regime, are building their own standards on the same ISSB foundation, so an organisation that reports well under UK SRS is largely aligned with what's expected elsewhere too.",
        faqSchema: true,
        link: { href: "/regulations", label: "See the wider regulatory picture" },
      },
      {
        q: "What is FCA CP26/5 and what does it propose?",
        a: "FCA CP26/5 is the Financial Conduct Authority's consultation on replacing its existing TCFD-based climate disclosure rules with rules requiring reporting under UK SRS. It ran from 30 January to 20 March 2026 and proposed mandatory reporting under UK SRS S2 for around 515 listed companies from 1 January 2027, with a “comply or explain” approach for the aspects companies find hardest to report. The FCA's policy statement confirming the final rules is expected in autumn 2026.",
        faqSchema: true,
      },
      {
        q: "Who has to report under UK SRS, and when?",
        a: "As proposed, mandatory UK SRS S2 reporting would apply to roughly 515 companies listed under specific UK Listing Rule categories, from accounting periods starting on or after 1 January 2027, with first reports published in 2028. That's a far narrower population than SECR, which reaches around 11,900 UK organisations. AIM-listed and private companies aren't directly in scope of the current proposal. Some transitional relief is proposed too: Scope 3 emissions reporting relief runs until 2028, and a two-year relief on UK SRS S1 reporting runs until 2029.",
        faqSchema: true,
      },
    ],
  },
  {
    name: "The four pillars of UK SRS",
    items: [
      {
        q: "What does UK SRS actually ask a company to disclose?",
        a: "Like the ISSB standards they're based on, UK SRS S1 and S2 organise disclosure around four pillars: Governance (board oversight and management responsibility for sustainability risks), Strategy (how the risks and opportunities affect the business model and value over different time horizons), Risk Management (how risks are identified, assessed and monitored), and Metrics and Targets (quantified progress, including Scope 1, 2 and 3 emissions measured under the GHG Protocol). UK SRS S2 adds a requirement for quantified climate scenario analysis and transition plan disclosures on top of that four-pillar structure.",
        faqSchema: true,
      },
      {
        q: "Is this the same four-pillar structure as TCFD?",
        a: "Yes. The ISSB standards, and UK SRS with them, were built to carry the TCFD framework's four pillars forward after the Task Force on Climate-related Financial Disclosures was formally disbanded in 2023. Organisations that already report against TCFD, or against SECR and a Carbon Reduction Plan, have a genuine head start.",
        faqSchema: true,
        link: { href: "/carbon-reduction-plans", label: "See our Carbon Reduction Plan support" },
      },
    ],
  },
  {
    name: "Getting ready",
    items: [
      {
        q: "We're not one of the ~515 companies directly in scope — does UK SRS still matter to us?",
        a: "Often, yes. Being outside the FCA's mandatory list doesn't mean you're outside the pressure. Listed companies in scope will be asking their suppliers for the emissions and sustainability data they need to complete their own UK SRS S2 disclosures, particularly on Scope 3. Lenders, insurers and larger customers increasingly use the same four-pillar framework as a proxy for maturity, even where no formal requirement exists. Getting ahead of it, rather than reacting to a customer request, is usually the cheaper path.",
        faqSchema: true,
      },
      {
        q: "What does “UK SRS readiness” actually mean in practice?",
        a: "Readiness means having, for each of the four pillars, the governance, data and processes in place to produce a UK SRS-standard disclosure without a scramble. In practice that means a named senior owner for sustainability decisions, a documented plan connecting sustainability to business strategy, a working risk register that covers climate risk alongside other business risks, and emissions and target data collected consistently enough to report, and eventually assure.",
        faqSchema: true,
      },
      {
        q: "How do you assess UK SRS readiness?",
        a: "We run a structured readiness assessment against the same four pillars UK SRS itself uses — Governance, Strategy, Risk Management, and Metrics & Targets — scoring evidence-based questions in each area on a three-point scale, from a basic, compliance-only response through to a fully embedded, board-level one. It's usually run as a workshop with your team, so the scoring reflects a shared, honest view rather than a guess, and it leaves you with a clear picture of where the real gaps are and what to tackle first.",
        faqSchema: true,
        link: { href: "/nz-insights-pro", label: "See NZ Insights Pro" },
      },
    ],
  },
];

const faqs = faqPageSchema(
  "/uk-srs-readiness",
  topics.flatMap((topic) => topic.items).filter((item) => item.faqSchema)
);

export default function UkSrsReadinessPage() {
  return (
    <>
      <JsonLd data={service} />
      <JsonLd data={breadcrumbs} />
      <JsonLd data={faqs} />
      <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">UK SRS Readiness</p>
        <h1>UK Sustainability Reporting Standards, explained in plain English.</h1>
        <p className="lead">
          UK SRS — the UK Sustainability Reporting Standards — are the UK&apos;s endorsed version of
          the ISSB&apos;s global sustainability standards, IFRS S1 and IFRS S2. Published in February
          2026, they set out how a company should report the sustainability risks and opportunities
          affecting its business, with a strong focus on climate. The FCA has proposed making
          climate reporting under UK SRS mandatory for around 515 listed companies from January
          2027, and many more organisations are expected to feel the effects through customer,
          investor and lender expectations well before then.
        </p>
        <p className="muted">Last updated: August 2026</p>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Context"
          title="Why this matters now"
          description="UK SRS moves the UK from voluntary, ISSB-aligned climate reporting toward a mandatory regime, decided by the FCA rather than left to individual companies to interpret. Even organisations well outside the roughly 515 companies directly in scope are starting to see the same four-pillar framework show up in customer questionnaires, financing conversations and public procurement, because it's becoming the common language for sustainability maturity. Understanding where you stand against it now is cheaper than finding out under time pressure later."
        />
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
          title="A readiness assessment, and a plan to close the gaps"
          description="We built our UK SRS readiness assessment into NZ Insights Pro, our carbon measurement and reporting platform, so scoring your organisation against the four pillars sits alongside your actual emissions data, not in a separate spreadsheet. Once we've scored where you stand, we help you close the gaps that matter most — whether that's formalising governance and ownership, building out a risk register, improving the quality of your Scope 1, 2 and 3 data, or setting credible, evidenced targets — so that when UK SRS reporting does apply to you, directly or through a customer's supply chain, you're ready rather than starting from nothing."
        />
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Next step"
          title="Not sure where you stand against UK SRS? Let's find out."
        />
        <Link href="/contact" className="btn btn-primary">
          Book a UK SRS readiness assessment <ArrowRight size={16} />
        </Link>

        <div className="related-links">
          <Link href="/regulations" className="related-link">Regulations</Link>
          <Link href="/nz-insights-pro" className="related-link">NZ Insights Pro</Link>
          <Link href="/carbon-reduction-plans" className="related-link">Carbon Reduction Plans</Link>
          <Link href="/scope-3" className="related-link">Scope 3</Link>
          <Link href="/contact" className="related-link">Contact</Link>
        </div>
      </section>
      </div>
    </>
  );
}
