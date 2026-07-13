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
    title: "Net zero strategy",
    summary: "High-level advisory, roadmap design, and executive-ready planning that can scale from one-off engagements to recurring advisory.",
  },
  {
    title: "Reporting and compliance",
    summary: "Clear service pages for carbon reporting, disclosures, and regulatory support, with room for live data and document delivery.",
  },
  {
    title: "Training and workshops",
    summary: "Event pages, booking flows, and content hubs for CPD training, workshops, and repeatable learning programs.",
  },
  {
    title: "Client portal and tooling",
    summary: "Connect the public site to authenticated products when needed without forcing the marketing site to become the app.",
  },
  {
    title: "Resources and knowledge",
    summary: "Glossary, FAQs, guides, and explainers that answer search intent and support AI retrieval.",
  },
  {
    title: "Lead capture and CRM",
    summary: "Forms, calls to action, and tracking that can later feed into your CRM and follow-up workflows.",
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
