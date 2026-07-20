import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/SectionHeading";

export const metadata: Metadata = {
  title: "Carbon Reporting & Regulations | UK, EU & Global Disclosure",
  description:
    "A plain-English guide to carbon reporting regulations — SECR, CSRD, CBAM, ISSB, the US SEC rule, California, Australia's ASRS and Singapore's ACRA — and how Net Zero International helps you respond.",
};

const regions = [
  {
    name: "United Kingdom",
    items: [
      {
        q: "What are the mandatory reporting thresholds for SECR in the UK?",
        a: "SECR (Streamlined Energy and Carbon Reporting) applies to all quoted UK companies, and to large unquoted companies and LLPs. “Large” means meeting at least two of three tests: turnover of £36 million or more, a balance sheet total of £18 million or more, or 250 or more employees. Organisations using 40 MWh or less of energy a year are exempt from the detailed disclosure but must still state that they are a low energy user.",
      },
      {
        q: "Who needs a Carbon Reduction Plan for UK public sector contracts?",
        a: "UK central government procurement requires bidders for major contracts (currently those above £5 million a year) to publish a Carbon Reduction Plan confirming a commitment to net zero by 2050 and reporting their emissions, under Cabinet Office procurement policy. Many wider public bodies, including the NHS, apply similar expectations. A compliant plan must cover the required emissions scopes and be published in the specified format.",
      },
      {
        q: "How does the NHS Evergreen framework assess carbon footprint?",
        a: "NHS Evergreen is the NHS supplier sustainability assessment. It asks suppliers to self-assess their net zero maturity across areas such as carbon reduction plans, emissions reporting, and progress toward the NHS's net zero targets, and scores them across levels. The rating increasingly influences NHS procurement, so a credible carbon reduction plan and a solid emissions baseline are the foundation of a strong Evergreen submission.",
      },
      {
        q: "What is the UK's SDR (Sustainability Disclosure Requirements)?",
        a: "The UK's SDR is the Financial Conduct Authority's regime for sustainability-related disclosures and investment product labels, introduced with anti-greenwashing rules to make sustainability claims clearer and more trustworthy. In parallel, the UK is developing UK Sustainability Reporting Standards (UK SRS) based on the ISSB standards, which would underpin future corporate climate disclosure.",
      },
      {
        q: "UK ETS",
        a: "The UK Emissions Trading Scheme is the UK's cap-and-trade carbon market, putting a price on emissions from energy-intensive industries, power generation and aviation covered by the scheme. It operates independently of the EU ETS following Brexit.",
      },
    ],
  },
  {
    name: "Europe",
    items: [
      {
        q: "Does CSRD affect UK companies?",
        a: "The EU Corporate Sustainability Reporting Directive (CSRD) can apply to UK companies with significant operations, turnover or listed securities in the EU, as well as UK subsidiaries of in-scope EU groups. Scope and timelines were narrowed and delayed by the EU's 2025 “Omnibus” simplification package, so the exact obligations depend on your EU footprint and the current phase-in. UK groups with material EU activity should check their position rather than assume they are out of scope.",
      },
      {
        q: "EU ETS",
        a: "The EU Emissions Trading System is the EU's cap-and-trade carbon market and the world's largest, pricing emissions from covered industrial installations, power, aviation and maritime. It is closely linked to the EU CBAM, which extends a carbon price to imports of certain goods.",
      },
      {
        q: "CBAM (EU and UK)",
        a: "The Carbon Border Adjustment Mechanism puts a carbon price on the embedded emissions of certain imported goods. The EU CBAM entered its definitive phase in January 2026; the UK introduces its own CBAM in January 2027.",
        link: { href: "/cbam", label: "See our CBAM page" },
      },
    ],
  },
  {
    name: "North America",
    items: [
      {
        q: "What is the status of the US SEC climate disclosure rule?",
        a: "The US SEC adopted a climate-related disclosure rule in March 2024, but it was stayed amid legal challenge and never took effect. In May 2026 the SEC proposed to rescind the rule in its entirety, with a comment period running into August 2026, meaning US federal climate disclosure is currently being withdrawn rather than expanded. In practice, US-listed companies revert to existing principles-based, materiality-driven disclosure, while many continue to report voluntarily to meet investor and customer expectations. We help organisations navigate this uncertainty and keep credible, decision-useful reporting in place.",
      },
      {
        q: "What is California's climate accountability package (SB 253 and SB 261)?",
        a: "California's climate accountability package is two laws that reach many large companies doing business in the state, regardless of where they are headquartered. SB 253 requires companies with over $1 billion in revenue to report Scope 1, 2 and 3 emissions with third-party assurance, with first Scope 1 and 2 reporting in 2026 (the initial deadline deferred to November 2026, with first-year enforcement discretion). SB 261 requires companies with over $500 million in revenue to publish biennial climate-related financial risk reports, though enforcement of the initial deadline is currently stayed by a Ninth Circuit injunction pending appeal.",
      },
    ],
  },
  {
    name: "Asia-Pacific",
    items: [
      {
        q: "What is Australia's ASRS (Australian Sustainability Reporting Standards)?",
        a: "Australia has introduced mandatory climate-related financial disclosure under the Australian Sustainability Reporting Standards, based on AASB S2 and aligned to the ISSB. Reporting is being phased in from 1 January 2025, starting with the largest entities and extending to more organisations over time.",
      },
      {
        q: "What are Singapore's ACRA climate reporting requirements?",
        a: "Singapore is phasing in mandatory climate-related disclosures aligned to the ISSB standards, overseen by ACRA and SGX. Listed issuers report first, with large non-listed companies brought into scope in later years.",
      },
    ],
  },
  {
    name: "The global baseline",
    items: [
      {
        q: "What are the ISSB Standards (IFRS S1 and IFRS S2)?",
        a: "The ISSB Standards, IFRS S1 (general sustainability disclosures) and IFRS S2 (climate-related disclosures), are the emerging global baseline for sustainability reporting, designed so a single, comparable standard can be adopted or endorsed by jurisdictions worldwide. Australia, Singapore, the UK and many other markets are building their regimes on top of them. Net Zero International develops its reporting under the ISSB Standards, alongside the GHG Protocol and GRI, so your data is ready wherever disclosure rules land.",
      },
    ],
  },
];

export default function RegulationsPage() {
  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">Reporting &amp; Regulations</p>
        <h1>Carbon reporting regulations, explained in plain English.</h1>
        <p className="lead">
          The rules on measuring and disclosing emissions are multiplying and changing fast,
          across the UK, Europe, North America, and Asia-Pacific. We translate that shifting
          landscape into practical advice, so you know what applies to your organisation, what&apos;s
          coming, and how to respond with confidence. Where you report across borders, we help
          you meet several regimes from one consistent set of emissions data.
        </p>
        <p className="muted">Last updated: July 2026</p>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Context"
          title="Why this matters now"
          description="Carbon and climate disclosure has moved from voluntary good practice to a patchwork of mandates, procurement conditions and market expectations that differ by country, and some are being tightened while others are being pulled back. For any organisation operating in more than one market, the challenge is no longer whether to report, but how to satisfy several overlapping frameworks without duplicating the work."
        />
      </section>

      {regions.map((region) => (
        <section className="content-section" key={region.name}>
          <SectionHeading eyebrow="Regional guide" title={region.name} />
          <div className="page-layout">
            {region.items.map((item) => (
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
          title="One dataset, every jurisdiction you report in"
          description="We keep track of these regimes so you don't have to. We tell you which apply to your organisation today, which are coming, and what “good” looks like for each, then we measure and report your emissions once, in a way that satisfies the frameworks you're subject to. For multinational organisations, our platform, NZ Insights Pro, lets one consistent emissions dataset feed several jurisdictions' obligations, rather than running a separate exercise for each."
        />
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Next step"
          title="Not sure which rules apply to you? Let's make it clear."
        />
        <Link href="/contact" className="btn btn-primary">
          Discuss reporting support <ArrowRight size={16} />
        </Link>

        <div className="related-links">
          <Link href="/cbam" className="related-link">CBAM</Link>
          <Link href="/carbon-reduction-plans" className="related-link">Carbon Reduction Plans</Link>
          <Link href="/scope-3" className="related-link">Scope 3</Link>
          <Link href="/nz-insights-pro" className="related-link">NZ Insights Pro</Link>
          <Link href="/contact" className="related-link">Contact</Link>
        </div>
      </section>
    </div>
  );
}
