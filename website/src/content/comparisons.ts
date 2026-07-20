export type ComparisonPage = {
  slug: string;
  titleTag: string;
  metaDescription: string;
  h1: string;
  answer: string;
  atAGlance: { label: string; text: string }[];
  bodyTitle: string;
  body: string;
  links: { href: string; label: string }[];
  ctaLabel: string;
  ctaHref: string;
};

export const comparisonPages: ComparisonPage[] = [
  {
    slug: "pcf-vs-lca",
    titleTag: "PCF vs LCA: What's the difference?",
    metaDescription:
      "A product carbon footprint (PCF) measures one impact — carbon — while a life cycle assessment (LCA) measures many. Here's how they relate and which you need.",
    h1: "What is the difference between a PCF and a life cycle assessment (LCA)?",
    answer:
      "A product carbon footprint (PCF) measures one impact, greenhouse gas emissions, expressed as CO₂e, for a product. A life cycle assessment (LCA) is broader, measuring multiple environmental impacts (carbon, water, land use, resource depletion and more) across the same life cycle. In practice a PCF is the climate-change slice of a full LCA: same life-cycle method (ISO 14040/14044), but reported against ISO 14067.",
    atAGlance: [
      {
        label: "PCF",
        text: "one impact (carbon, as CO₂e); standard ISO 14067; answers “what's this product's carbon footprint?”",
      },
      {
        label: "LCA",
        text: "many environmental impacts; standard ISO 14040/14044; answers “what's this product's full environmental profile?”",
      },
    ],
    bodyTitle: "Which do you need?",
    body: "If a customer, tender or Scope 3 process is asking specifically for carbon, a PCF is enough. If you're making eco-design or materials decisions, or producing an Environmental Product Declaration, you'll want the fuller picture an LCA gives. The two are compatible, a PCF often falls out of an LCA.",
    links: [
      { href: "/product-carbon-footprinting", label: "Product Carbon Footprinting" },
      { href: "/life-cycle-assessments", label: "Life Cycle Assessments" },
    ],
    ctaLabel: "Talk to us",
    ctaHref: "/contact",
  },
  {
    slug: "ccf-vs-pcf",
    titleTag: "Corporate vs product carbon footprint (CCF vs PCF)",
    metaDescription:
      "A corporate carbon footprint measures a whole organisation's emissions; a product carbon footprint measures one product. Here's how they differ and connect.",
    h1: "What is the difference between a corporate carbon footprint (CCF) and a product carbon footprint (PCF)?",
    answer:
      "A corporate carbon footprint (CCF) measures all of an organisation's emissions over a year across Scopes 1, 2 and 3. A product carbon footprint (PCF) measures the emissions of a single product across its life cycle. A CCF answers “how much does our business emit?”; a PCF answers “how much does this item emit?”, and many PCFs feed into the Scope 3 part of a CCF.",
    atAGlance: [
      {
        label: "CCF",
        text: "whole organisation, one year, Scopes 1–3; used for SECR, CSRD, carbon reduction plans.",
      },
      {
        label: "PCF",
        text: "one product, full life cycle; used for customer requests, Scope 3 Category 1, CBAM.",
      },
    ],
    bodyTitle: "Which do you need?",
    body: "Most organisations need a CCF for reporting and reduction planning. You need PCFs when customers ask for product-level carbon data, or when you want primary data for the “purchased goods and services” part of your own Scope 3.",
    links: [
      { href: "/carbon-reduction-plans", label: "Carbon Reduction Plans" },
      { href: "/product-carbon-footprinting", label: "Product Carbon Footprinting" },
      { href: "/scope-3", label: "Scope 3" },
    ],
    ctaLabel: "Talk to us",
    ctaHref: "/contact",
  },
  {
    slug: "scope-1-2-3-emissions",
    titleTag: "Scope 1, 2 and 3 emissions explained",
    metaDescription:
      "Scope 1 is direct emissions, Scope 2 is purchased energy, and Scope 3 is everything else in your value chain. A plain-English guide to the three scopes.",
    h1: "What is the difference between Scope 1, 2 and 3 emissions?",
    answer:
      "The three scopes divide up an organisation's greenhouse gas emissions by source. Scope 1 is direct emissions from sources you own or control (e.g. fuel burned on site, company vehicles). Scope 2 is indirect emissions from the energy you purchase (mainly electricity). Scope 3 is all other indirect emissions across your value chain, purchased goods and services, business travel, transport, use of sold products and more, and is usually the largest and hardest to measure.",
    atAGlance: [
      { label: "Scope 1", text: "direct: on-site fuel, company vehicles, process emissions." },
      { label: "Scope 2", text: "indirect from purchased energy: electricity, heat, steam." },
      {
        label: "Scope 3",
        text: "all other value-chain emissions, upstream and downstream (15 categories in the GHG Protocol).",
      },
    ],
    bodyTitle: "Why it matters",
    body: "Most reporting frameworks (SECR, CSRD, ISSB) and reduction plans are built around the three scopes. Scope 3 typically dominates the total and is where supplier data, and product carbon footprints, become essential.",
    links: [
      { href: "/scope-3", label: "Scope 3" },
      { href: "/carbon-reduction-plans", label: "Carbon Reduction Plans" },
      { href: "/glossary", label: "Glossary" },
    ],
    ctaLabel: "Talk to us",
    ctaHref: "/contact",
  },
  {
    slug: "cradle-to-gate-vs-cradle-to-grave",
    titleTag: "Cradle-to-gate vs cradle-to-grave carbon footprints",
    metaDescription:
      "Cradle-to-gate covers emissions up to the factory gate; cradle-to-grave covers the full life cycle including use and disposal. Here's when to use each.",
    h1: "What is the difference between cradle-to-gate and cradle-to-grave?",
    answer:
      "These are two system boundaries for a product footprint. Cradle-to-gate covers emissions from raw-material extraction up to the point the finished product leaves the factory gate, it excludes distribution, use and end-of-life. Cradle-to-grave extends across the entire life cycle, adding those downstream stages. Cradle-to-gate is the most common boundary for business-to-business footprints because the manufacturer controls the data up to the gate.",
    atAGlance: [
      { label: "Cradle-to-gate", text: "materials + manufacturing, up to the factory gate." },
      {
        label: "Cradle-to-grave",
        text: "the whole life cycle: materials, manufacturing, distribution, use, end-of-life.",
      },
    ],
    bodyTitle: "Which do you need?",
    body: "Cradle-to-gate suits most supplier and Scope 3 requests. Cradle-to-grave is needed when the use and disposal phases are material, for example energy-using products, or when a customer or standard requires the full picture.",
    links: [
      { href: "/product-carbon-footprinting", label: "Product Carbon Footprinting" },
      { href: "/life-cycle-assessments", label: "Life Cycle Assessments" },
    ],
    ctaLabel: "Talk to us",
    ctaHref: "/contact",
  },
  {
    slug: "eu-cbam-vs-uk-cbam",
    titleTag: "EU CBAM vs UK CBAM: what's the difference?",
    metaDescription:
      "The EU CBAM (definitive phase from 2026) uses certificates; the UK CBAM (from 2027) is a tax with a £50k threshold. Here's how the two schemes compare.",
    h1: "What is the difference between the EU CBAM and the UK CBAM?",
    answer:
      "They are separate carbon border schemes with different timings and mechanics. The EU CBAM entered its definitive phase on 1 January 2026 and works through importers surrendering certificates for the verified embedded emissions of covered goods. The UK CBAM starts on 1 January 2027, is a tax on the embedded emissions of certain imported goods rather than a certificate system, and applies only above a £50,000 12-month import threshold. A UK business exporting to the EU deals with the EU scheme through its customers, while also facing the UK scheme on its own relevant imports.",
    atAGlance: [
      {
        label: "EU CBAM",
        text: "definitive phase from Jan 2026; certificate-based; first declaration for 2026 imports due Sep 2027.",
      },
      {
        label: "UK CBAM",
        text: "from Jan 2027; tax-based; £50,000 threshold; first period annual, payment due end of May 2028.",
      },
    ],
    bodyTitle: "How we help",
    body: "Whether you export affected goods to the EU or import them into the UK, we calculate embedded emissions to the required methodology and prepare verification-ready, submission-ready reporting for both schemes.",
    links: [
      { href: "/cbam", label: "CBAM Calculation & Reporting" },
      { href: "/product-carbon-footprinting", label: "Product Carbon Footprinting" },
    ],
    ctaLabel: "Discuss CBAM support",
    ctaHref: "/contact",
  },
  {
    slug: "embodied-carbon-vs-embedded-emissions",
    titleTag: "Embodied carbon vs embedded emissions",
    metaDescription:
      "Embodied carbon is a life-cycle concept; embedded emissions is the specific term CBAM uses, with prescribed rules. Here's how they differ.",
    h1: "Is embodied carbon the same as embedded emissions?",
    answer:
      "They are related but defined differently. “Embodied carbon” is a broad life-cycle concept, the emissions locked into a product's materials and manufacturing, most common in the built environment. “Embedded emissions” is the specific term the Carbon Border Adjustment Mechanism (CBAM) uses for the greenhouse gases released in producing an imported good, calculated with a prescribed methodology and boundary. Because CBAM embedded emissions are a regulated subset with set rules, a general embodied-carbon or product footprint usually needs adjusting to meet the CBAM definition.",
    atAGlance: [
      { label: "Embodied carbon", text: "general life-cycle concept; flexible boundaries; common in construction." },
      {
        label: "Embedded emissions",
        text: "CBAM-specific; prescribed method and boundary; used for import declarations.",
      },
    ],
    bodyTitle: "How we help",
    body: "We adjust general product footprints to meet the CBAM definition of embedded emissions where needed, and calculate them from scratch to the required methodology where they don't yet exist.",
    links: [
      { href: "/cbam", label: "CBAM Calculation & Reporting" },
      { href: "/product-carbon-footprinting", label: "Product Carbon Footprinting" },
    ],
    ctaLabel: "Discuss CBAM support",
    ctaHref: "/contact",
  },
  {
    slug: "primary-vs-secondary-data",
    titleTag: "Primary vs secondary data in carbon accounting",
    metaDescription:
      "Primary data is measured directly from the source; secondary data is a database average. Here's the difference and when each is good enough.",
    h1: "What is the difference between primary and secondary data in carbon accounting?",
    answer:
      "Primary data is measured directly from the specific activity or supplier, actual energy use, or a supplier's own product footprint. Secondary data is an average or modelled figure from a database, used as a proxy when primary data isn't available. Primary data is more accurate and more defensible in audit, CBAM and assured Scope 3; secondary data is faster but coarser. Good practice is to prioritise primary data for your largest and most carbon-intensive activities, and use secondary data to fill the gaps.",
    atAGlance: [
      { label: "Primary data", text: "measured from the source; higher accuracy; needed for audit/CBAM/assurance." },
      { label: "Secondary data", text: "database averages/factors; quick; fine for smaller or lower-impact items." },
    ],
    bodyTitle: "How we help",
    body: "NZ Insights Pro is built to capture primary data where it exists and fall back to recognised international emission-factor datasets where it doesn't, so your figures are as accurate as your data allows and clearly documented either way.",
    links: [
      { href: "/scope-3", label: "Scope 3" },
      { href: "/product-carbon-footprinting", label: "Product Carbon Footprinting" },
      { href: "/nz-insights-pro", label: "NZ Insights Pro" },
    ],
    ctaLabel: "Talk to us",
    ctaHref: "/contact",
  },
];
