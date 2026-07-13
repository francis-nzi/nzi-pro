export const navLinks = [
  { href: "/services", label: "Services" },
  { href: "/ai-era", label: "AI Era" },
  { href: "/resources", label: "Resources" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export const homeStats = [
  { label: "Strategy first", value: "Content model + IA" },
  { label: "Built for AI search", value: "Schema + answer pages" },
  { label: "Render ready", value: "Standalone service" },
  { label: "Dynamic later", value: "API hooks pre-wired" },
];

export const aiPrinciples = [
  {
    title: "Answer the question on the page",
    text: "Each page should stand alone with a clear point of view, direct answers, and enough context for both humans and AI agents.",
  },
  {
    title: "Structure everything",
    text: "Use named entities, schema.org markup, internal links, and content blocks that can be reused across pages, search, and assistants.",
  },
  {
    title: "Ship fast, then connect data",
    text: "The first release should be server-rendered, content-driven, and easy to extend with CRM, calculators, and portals later.",
  },
  {
    title: "Design for trust",
    text: "Proof, team, process, and contact paths should be obvious. Visitors should always know who you are, what you do, and what to do next.",
  },
];

export const serviceCards = [
  {
    href: "/scope-3",
    title: "Net zero strategy",
    summary: "High-level advisory, roadmap design, and executive-ready planning that can scale from one-off engagements to recurring advisory.",
  },
  {
    href: "/regulations",
    title: "Reporting and compliance",
    summary: "Clear service pages for carbon reporting, disclosures, and regulatory support, with room for live data and document delivery.",
  },
  {
    href: "/training",
    title: "Training and workshops",
    summary: "Event pages, booking flows, and content hubs for CPD training, workshops, and repeatable learning programs.",
  },
  {
    title: "Client portal and tooling",
    summary: "Connect the public site to authenticated products when needed without forcing the marketing site to become the app.",
  },
  {
    href: "/resources",
    title: "Resources and knowledge",
    summary: "Glossary, FAQs, guides, and explainers that answer search intent and support AI retrieval.",
  },
  {
    title: "Lead capture and CRM",
    summary: "Forms, calls to action, and tracking that can later feed into your CRM and follow-up workflows.",
  },
];

export const servicePages = [
  {
    slug: "scope-3",
    eyebrow: "Scope 3",
    title: "Scope 3 solutions built for teams that need clarity, not jargon.",
    description:
      "We help organisations turn indirect emissions into a manageable workstream with a clear method, an owner, and reporting outputs that leadership can use.",
    sections: [
      {
        title: "What the page should say",
        points: [
          "The scope of the problem and where the data usually lives",
          "A plain-English explanation of the approach",
          "The outputs the client will receive",
        ],
      },
      {
        title: "Ideal for",
        points: [
          "Businesses starting their Scope 3 journey",
          "Teams needing supplier engagement and category prioritisation",
          "Organisations preparing for reporting or roadmap work",
        ],
      },
      {
        title: "Typical deliverables",
        points: [
          "Category screening",
          "Data collection templates",
          "Hotspot analysis",
          "Action plan and presentation pack",
        ],
      },
    ],
  },
  {
    slug: "workshops",
    eyebrow: "Workshops",
    title: "Strategy workshops that get leadership aligned quickly.",
    description:
      "A good workshop page should make the offer feel tangible: who attends, what happens, what gets produced, and how it moves the organisation forward.",
    sections: [
      {
        title: "Common workshop themes",
        points: [
          "Baseline review and ambition setting",
          "Roadmap and target planning",
          "Stakeholder and supplier engagement",
        ],
      },
      {
        title: "Workshop outputs",
        points: [
          "Facilitated notes",
          "Priority actions",
          "Decision log",
          "Next-step implementation brief",
        ],
      },
    ],
  },
  {
    slug: "training",
    eyebrow: "Training",
    title: "CPD accredited training that can scale from one session to a program.",
    description:
      "Training pages should support booking, session details, learning outcomes, and the evidence people need before they commit.",
    sections: [
      {
        title: "Training page needs",
        points: [
          "Course overview",
          "Who it is for",
          "Learning outcomes",
          "Accreditation and booking details",
        ],
      },
      {
        title: "Future-friendly structure",
        points: [
          "Repeatable session templates",
          "Content blocks for dates and locations",
          "Links to resources and follow-up material",
        ],
      },
    ],
  },
  {
    slug: "regulations",
    eyebrow: "Regulation",
    title: "Regulations and legislation explained in plain English.",
    description:
      "This page should help people understand what changed, why it matters, and how NZI can help them respond without overwhelm.",
    sections: [
      {
        title: "Useful content themes",
        points: [
          "Updates and summaries",
          "Who the change affects",
          "Practical implications",
          "Call to action for support",
        ],
      },
    ],
  },
];

export const resourcePages = [
  {
    slug: "glossary",
    eyebrow: "Glossary",
    title: "A glossary that makes the subject easier to navigate.",
    description:
      "Glossary pages help both visitors and search engines understand the language of the site.",
  },
  {
    slug: "faq",
    eyebrow: "FAQ",
    title: "A reusable FAQ surface for common questions.",
    description:
      "This can start as simple content and later become structured answer blocks used across the site and in AI search.",
  },
];

export const glossaryTerms = [
  {
    term: "Scope 1",
    definition: "Direct emissions from sources the organisation owns or controls.",
  },
  {
    term: "Scope 2",
    definition: "Indirect emissions from purchased electricity, heat, steam, or cooling.",
  },
  {
    term: "Scope 3",
    definition: "Other indirect emissions that occur in the value chain, upstream and downstream.",
  },
  {
    term: "Carbon footprint",
    definition: "A quantified measure of emissions associated with an organisation, product, or activity.",
  },
  {
    term: "Net zero",
    definition: "A state where residual emissions are balanced by removals or offsets according to the chosen standard.",
  },
  {
    term: "Baseline",
    definition: "The reference year or period used to measure progress over time.",
  },
];

export const buildPhases = [
  {
    title: "Phase 1: Foundation",
    points: ["Information architecture", "Visual system", "Content map", "SEO and schema"],
  },
  {
    title: "Phase 2: Core pages",
    points: ["Home", "Services", "About", "Contact", "AI-era explainer"],
  },
  {
    title: "Phase 3: Scale",
    points: ["Case studies", "Knowledge base", "Lead forms", "API-backed content"],
  },
];

export const faqs = [
  {
    q: "Why build a separate service instead of using the current WordPress stack?",
    a: "A separate service gives you a cleaner architecture, faster server rendering, better schema control, and less coupling between the public site and internal tools.",
  },
  {
    q: "Can we still pull in live data?",
    a: "Yes. The site can remain content-first while calling backend APIs for pricing, dashboards, booking availability, downloads, or any other dynamic surface later.",
  },
  {
    q: "Will this help with AI search and answer engines?",
    a: "Yes. The combination of structured content, metadata, schema, internal linking, and concise answer pages is exactly what AI-first discovery favors.",
  },
];
