export const navLinks = [
  { href: "/services", label: "Services" },
  { href: "/carbon-reduction-plans", label: "Carbon Reduction Plans" },
  { href: "/scope-3", label: "Scope 3" },
  { href: "/nz-insights-pro", label: "NZ Insights Pro" },
  { href: "/training", label: "Training" },
  { href: "/resources", label: "Resources" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export const homeStats = [
  { label: "Carbon accounting and reporting", value: "Scopes 1, 2 & 3" },
  { label: "Public procurement support", value: "PPN 006 / NHS Evergreen" },
  { label: "Capability building", value: "CPD accredited" },
  { label: "Practical delivery", value: "Workshops and roadmaps" },
];

export const aiPrinciples = [
  {
    title: "Specialist expertise",
    text: "We bring deep knowledge of carbon accounting, sustainability frameworks, and sector-specific delivery challenges.",
  },
  {
    title: "Regulatory insight",
    text: "We stay close to the standards that matter, including SECR, PPN 006, CSRD, and NHS Evergreen.",
  },
  {
    title: "Tailored and practical",
    text: "No one-size-fits-all advice. We shape the work around your sector, timeline, and available data.",
  },
  {
    title: "People-centred delivery",
    text: "Net zero only works when teams understand it. We build capability, not just reports.",
  },
];

export const serviceCards = [
  {
    href: "/carbon-reduction-plans",
    title: "Carbon reduction plans",
    summary: "Measure and report emissions, then shape a plan that works for procurement, governance, and board approval.",
  },
  {
    href: "/scope-3",
    title: "Scope 3 supply chain solutions",
    summary: "Measure indirect emissions and build a practical approach to supplier engagement and category prioritisation.",
  },
  {
    href: "/workshops",
    title: "Net Zero strategy workshops",
    summary: "Facilitated sessions that align leadership, identify priorities, and turn strategy into clear next steps.",
  },
  {
    href: "/training",
    title: "CPD accredited training",
    summary: "Courses and workshops that build internal capability across leadership, procurement, finance, and operations.",
  },
  {
    href: "/regulations",
    title: "Reporting and compliance",
    summary: "Support for SECR, CSRD, PPN 006, NHS Evergreen, and wider sustainability reporting.",
  },
  {
    href: "/resources",
    title: "Guides, glossary, and FAQs",
    summary: "Supporting content that helps clients understand the terminology and the process before they commit.",
  },
  {
    href: "/life-cycle-assessments",
    title: "Life Cycle Assessments",
    summary: "Measure the full environmental impact of a product or service to ISO 14040/14044, the basis for footprints, EPDs and eco-design.",
  },
  {
    href: "/product-carbon-footprinting",
    title: "Product Carbon Footprinting",
    summary: "ISO 14067-aligned carbon footprints for individual products, ready for customers, Scope 3 and CBAM.",
  },
  {
    href: "/cbam",
    title: "CBAM Calculation & Reporting",
    summary: "Embedded-emissions calculation and reporting for the EU CBAM (2026) and UK CBAM (2027).",
  },
  {
    href: "/nz-insights-pro",
    title: "NZ Insights Pro",
    summary: "Our proprietary platform for measuring and reporting emissions across multi-site, multi-country organisations.",
  },
];

type ServiceSection = {
  title: string;
  points?: string[];
  body?: string;
};

type RelatedLink = {
  href: string;
  label: string;
};

type ServicePage = {
  slug: string;
  eyebrow: string;
  title: string;
  description: string;
  metaDescription?: string;
  ctaLabel?: string;
  nextStepTitle?: string;
  nextStepDescription?: string;
  sections?: ServiceSection[];
  relatedLinks?: RelatedLink[];
};

export const servicePages: ServicePage[] = [
  {
    slug: "carbon-reduction-plans",
    eyebrow: "Carbon Reduction Plans",
    title: "Carbon reduction plans that stand up to scrutiny.",
    description:
      "We measure and report your carbon emissions, then shape a practical reduction plan for procurement, compliance, and board-level decision making.",
    sections: [
      {
        title: "What this covers",
        points: [
          "Carbon emissions measurement and reporting",
          "A structured reduction plan with clear actions",
          "Support for public procurement and governance requirements",
        ],
      },
      {
        title: "Standards we work with",
        points: [
          "PPN 006 / PPN 06/21 procurement requirements",
          "NHS Evergreen carbon reduction plans",
          "SECR, GHG Protocol, and related reporting frameworks",
        ],
      },
      {
        title: "Typical outputs",
        points: [
          "Baseline emissions summary",
          "Draft carbon reduction plan",
          "Action plan and evidence pack",
          "Review and sign-off support",
        ],
      },
    ],
  },
  {
    slug: "scope-3",
    eyebrow: "Scope 3",
    title: "Scope 3 supply chain solutions built for clarity.",
    description:
      "We help organisations measure and report the emissions that sit in the supply chain, then build a realistic plan to engage suppliers and prioritise action.",
    sections: [
      {
        title: "What we help with",
        points: [
          "Supplier mapping and category screening",
          "Data collection templates and collection guidance",
          "Hotspot analysis and prioritisation",
        ],
      },
      {
        title: "Who it is for",
        points: [
          "Businesses starting their Scope 3 journey",
          "Teams needing supplier engagement and category prioritisation",
          "Organisations preparing for reporting or roadmap work",
        ],
      },
      {
        title: "Typical deliverables",
        points: [
          "Category screening and materiality view",
          "Supplier outreach templates",
          "Summary report and action plan",
        ],
      },
    ],
    relatedLinks: [
      { href: "/product-carbon-footprinting", label: "Product Carbon Footprinting" },
      { href: "/nz-insights-pro", label: "NZ Insights Pro" },
      { href: "/carbon-reduction-plans", label: "Carbon Reduction Plans" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    slug: "workshops",
    eyebrow: "Workshops",
    title: "Net Zero strategy workshops that get leadership aligned.",
    description:
      "We run focused sessions that help leadership teams agree ambition, understand the data, and leave with a workable plan.",
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
        title: "What the workshop produces",
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
    title: "CPD accredited training that builds internal confidence.",
    description:
      "Our training programmes help business leaders and teams understand carbon accounting, Net Zero strategy, and the actions that matter most.",
    sections: [
      {
        title: "Training themes",
        points: [
          "Net Zero essentials for leaders and teams",
          "Carbon accounting and reporting",
          "Climate leadership and operational delivery",
        ],
      },
      {
        title: "Delivery options",
        points: [
          "Online, on-site, or hybrid delivery",
          "CPD certificates and supporting materials",
          "Tailored programmes for sectors and teams",
        ],
      },
    ],
  },
  {
    slug: "regulations",
    eyebrow: "Reporting & Regulations",
    title: "Carbon reporting regulations, explained in plain English.",
    description:
      "The rules on measuring and disclosing emissions are multiplying and changing fast, across the UK, Europe, North America and Asia-Pacific. We translate that shifting landscape into practical advice, so you know what applies to you and how to respond.",
  },
  {
    slug: "life-cycle-assessments",
    eyebrow: "Life Cycle Assessments",
    title: "Life cycle assessments that stand up to scrutiny.",
    description:
      "A life cycle assessment (LCA) measures the environmental impact of a product or service across its full life cycle, from raw materials to end of life. We deliver LCAs to ISO 14040 and ISO 14044 that give you defensible, comparable results, the foundation for product carbon footprints, eco-design decisions, environmental product declarations and procurement requirements.",
    metaDescription:
      "We deliver ISO 14040/14044 life cycle assessments that measure a product or service's environmental impact across its full life cycle, to support disclosure, eco-design and procurement decisions.",
    ctaLabel: "Discuss a life cycle assessment",
    nextStepTitle: "Understand the full impact of your product.",
    sections: [
      {
        title: "What an LCA covers",
        body: "An LCA quantifies environmental impacts, including greenhouse gas emissions, water use, energy, resource depletion and more, across each stage of a product's life: materials, manufacturing, distribution, use and end of life. It follows the internationally recognised method set out in ISO 14040 and ISO 14044: define goal and scope, build the life cycle inventory, assess the impacts, and interpret the results. Done well, it shows exactly where impact sits and where change makes the biggest difference.",
      },
      {
        title: "What is the difference between an LCA and a product carbon footprint (PCF)?",
        body: "A life cycle assessment measures multiple environmental impacts (carbon, water, land use, resource depletion and more), while a product carbon footprint measures one: greenhouse gas emissions, expressed as CO₂e. A PCF is effectively the climate-change slice of a full LCA, calculated with the same life-cycle method (ISO 14040/14044) but reported against ISO 14067. If you only need the carbon number, a PCF is enough; if you need the wider environmental picture, you need an LCA.",
      },
      {
        title: "What does cradle-to-grave mean in carbon accounting?",
        body: "Cradle-to-grave means the assessment covers the product's entire life cycle, raw materials, manufacturing, distribution, use, and end-of-life disposal or recycling. It is the fullest boundary and is used when the use and disposal phases matter to the total, such as for energy-using products. The alternatives are cradle-to-gate (up to the factory gate) and cradle-to-cradle (where end-of-life feeds back into new production).",
      },
      {
        title: "What is a functional unit in carbon accounting?",
        body: "The functional unit is the quantified reference an assessment is measured against, for example “1 litre of packaged beverage delivered to the retailer,” not simply “a bottle.” It ensures like-for-like comparison: two products can only be compared if they deliver the same function in the same unit. Choosing the wrong functional unit is one of the most common LCA and PCF mistakes, which is why we agree it with you at the outset.",
      },
      {
        title: "Who an LCA is for",
        body: "LCAs suit organisations that need to understand or prove the environmental impact of what they make: manufacturers responding to customer and procurement questions, businesses developing Environmental Product Declarations (EPDs), teams making eco-design or materials decisions, and organisations preparing for disclosure. If a buyer, regulator or design decision hinges on environmental impact, an LCA gives you the evidence.",
      },
      {
        title: "How long does a life cycle assessment take?",
        body: "Timelines are driven by data availability more than anything else. Where activity and supplier data are ready, a focused assessment can be delivered in a matter of weeks; where data has to be gathered from multiple suppliers, it takes longer. Agreeing the functional unit, boundary and data sources up front is the single biggest factor in keeping it on schedule.",
      },
      {
        title: "What you get",
        body: "A completed LCA to ISO 14040/14044, a clear breakdown of impact by life cycle stage, the assumptions and data sources documented for audit, and practical guidance on where to act. Where relevant, the assessment feeds directly into a product carbon footprint (ISO 14067), an Environmental Product Declaration (ISO 14025, and EN 15804 for construction products), or your wider reporting.",
      },
    ],
    relatedLinks: [
      { href: "/product-carbon-footprinting", label: "Product Carbon Footprinting" },
      { href: "/scope-3", label: "Scope 3" },
      { href: "/regulations", label: "Regulations" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    slug: "product-carbon-footprinting",
    eyebrow: "Product Carbon Footprinting",
    title: "Product carbon footprints your customers can trust.",
    description:
      "A product carbon footprint (PCF) measures the greenhouse gas emissions of a single product across its life cycle, expressed as CO₂e. We calculate PCFs to ISO 14067 and the GHG Protocol Product Standard, giving you audit-ready figures for customer requests, Scope 3 reporting, procurement, and emerging regulation such as CBAM.",
    metaDescription:
      "We calculate product carbon footprints to ISO 14067 and the GHG Protocol Product Standard, cradle-to-gate or cradle-to-grave figures that stand up to customer, procurement and regulatory scrutiny.",
    ctaLabel: "Discuss product carbon footprinting",
    nextStepTitle: "Get a product footprint that holds up.",
    sections: [
      {
        title: "What is the difference between a PCF and a life cycle assessment (LCA)?",
        body: "A product carbon footprint measures one impact, greenhouse gas emissions as CO₂e, for a product. A life cycle assessment is broader, measuring multiple environmental impacts across the same life cycle. In practice a PCF is the climate-change slice of a full LCA, calculated with the same life-cycle method (ISO 14040/14044) but reported against ISO 14067. Most customer and procurement requests are for a PCF specifically.",
      },
      {
        title: "Is a product carbon footprint the same as embodied carbon?",
        body: "No. “Embodied carbon” usually means the emissions locked into the materials and construction of a building or asset (cradle-to-gate), a term common in the built environment. A product carbon footprint applies the same principle to any product and can extend across the full life cycle, including use and end-of-life. Embodied carbon is effectively a PCF scoped to the materials and manufacturing stages.",
      },
      {
        title: "What is a cradle-to-gate carbon footprint?",
        body: "A cradle-to-gate carbon footprint covers emissions from raw-material extraction (“cradle”) up to the point the finished product leaves the factory gate. It excludes downstream stages such as distribution, use and end-of-life, those are added in a “cradle-to-grave” footprint. Cradle-to-gate is the most common boundary for business-to-business PCFs because the manufacturer controls the data up to the gate.",
      },
      {
        title: "How do you calculate a product carbon footprint step by step?",
        body: "A PCF follows five core steps: define the functional unit and system boundary (for example cradle-to-gate per 1 kg of product); map the bill of materials, energy and processes; collect activity data, primary where possible and database factors where not; apply emission factors and allocate emissions across any co-products; then calculate, verify, and report against ISO 14067. The hardest parts are data collection and allocation, which is where our support pays for itself.",
      },
      {
        title: "How do you allocate carbon emissions to co-products?",
        body: "ISO 14044 sets a hierarchy. First, avoid allocation by sub-dividing the process or expanding the system boundary. If you can't, allocate on a physical relationship such as mass, energy content or volume. Only if that doesn't reflect the outputs should you allocate by economic value. The choice materially changes each co-product's footprint, so it must be documented and defensible, a frequent audit failure point in manufacturing and chemicals.",
      },
      {
        title: "How does product carbon footprinting connect to Scope 3 Category 1 reporting?",
        body: "Scope 3 Category 1 (“purchased goods and services”) is, in effect, the sum of the cradle-to-gate carbon footprints of everything an organisation buys. Supplier-specific PCFs give you primary data for that category instead of spend-based estimates, making Scope 3 far more accurate and audit-ready. That is why PCFs are the building blocks of a credible Scope 3 Category 1 figure, for you and for your customers.",
      },
      {
        title: "What standards govern product carbon footprints?",
        body: "The core standards are ISO 14067 (carbon footprint of products) and the GHG Protocol Product Life Cycle Accounting and Reporting Standard, both built on the LCA framework of ISO 14040 and ISO 14044. Sector schemes add specific rules, for example Product Category Rules for EPDs, and the EU's Product Environmental Footprint (PEF). We help you choose and apply the right one for your market and your customers.",
      },
      {
        title: "Can you do a product carbon footprint in Excel?",
        body: "You can start in Excel, and many organisations do, but it breaks down quickly. Spreadsheets struggle with version control, emission-factor updates, supplier data collection, allocation logic, and audit trails, which is exactly what procurement, CBAM and assurance now demand. Most organisations move to a structured, audit-ready approach once footprints must be verified or repeated each year, which is what we provide, backed by expert review.",
      },
      {
        title: "Who it's for and what you get",
        body: "PCFs suit manufacturers and suppliers facing customer carbon requests, procurement requirements, Scope 3 obligations, or CBAM exposure. You get an ISO 14067-aligned footprint per functional unit, the methodology and data sources documented for audit, and a clear view of the hotspots you can act on, ready to share with customers or fold into your wider reporting.",
      },
    ],
    relatedLinks: [
      { href: "/life-cycle-assessments", label: "Life Cycle Assessments" },
      { href: "/scope-3", label: "Scope 3" },
      { href: "/cbam", label: "CBAM" },
      { href: "/nz-insights-pro", label: "NZ Insights Pro" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    slug: "cbam",
    eyebrow: "CBAM Calculation and Reporting",
    title: "CBAM, calculated and reported with confidence.",
    description:
      "The Carbon Border Adjustment Mechanism (CBAM) puts a carbon price on the embedded emissions of certain imported goods. We calculate those embedded emissions and prepare the reporting you need for both the EU CBAM (definitive phase from January 2026) and the UK CBAM (from January 2027), so affected exporters and importers stay compliant and keep their customers.",
    metaDescription:
      "We calculate embedded emissions and prepare CBAM reporting for the EU CBAM (definitive phase from 2026) and the UK CBAM (from 2027), helping UK exporters and importers of affected goods stay compliant.",
    ctaLabel: "Discuss CBAM support",
    nextStepTitle: "Stay ahead of CBAM — EU and UK.",
    nextStepDescription:
      "Whether you export affected goods to the EU or import them into the UK, we'll calculate your embedded emissions and get your reporting ready.",
    sections: [
      {
        title: "How do you report a product's emissions for the EU CBAM?",
        body: "Under the EU CBAM definitive phase (from 1 January 2026), EU importers of covered goods, iron & steel, aluminium, cement, fertilisers, hydrogen and electricity, must declare the verified embedded emissions of their imports and, from 2027, surrender CBAM certificates. As a UK (non-EU) producer or exporter, your role is to calculate the embedded emissions of the goods you supply, have them verified by an accredited third party, and provide that data to your EU customers. The first annual declaration, covering 2026 imports, is due 30 September 2027, we help you calculate, document and supply the data your customers need.",
      },
      {
        title: "Does the UK have its own CBAM, and when does it start?",
        body: "Yes. The UK CBAM starts on 1 January 2027 and applies to imports of aluminium, cement, fertiliser, hydrogen, and iron & steel. Only businesses importing £50,000 or more of CBAM goods over a 12-month period are in scope. The first accounting period is annual (2027) with payment due at the end of May 2028; indirect emissions are excluded until at least 2029.",
      },
      {
        title: "What is the difference between the EU CBAM and the UK CBAM?",
        body: "They are separate schemes with different timings and mechanics. The EU CBAM entered its definitive phase on 1 January 2026 and works through importers surrendering certificates for verified embedded emissions. The UK CBAM starts on 1 January 2027, is a tax on the embedded emissions of certain imported goods rather than a certificate system, and has a £50,000 import threshold. A UK business exporting to the EU deals with the EU scheme via its customers, while also facing the UK scheme on its own relevant imports, we help with both.",
      },
      {
        title: "Is embodied carbon the same as CBAM embedded emissions?",
        body: "They are related but defined differently. “Embedded emissions” is the specific CBAM term for the greenhouse gases released in producing an imported good, calculated using the CBAM methodology and system boundary. Embodied carbon is a broader life-cycle concept; CBAM embedded emissions are a regulated subset with prescribed rules, so a general product footprint usually needs adjusting to meet the CBAM definition, which is part of what we do.",
      },
      {
        title: "What are the carbon reporting requirements for UK exporters to the EU?",
        body: "UK exporters of CBAM-covered goods to the EU are not directly regulated by the EU CBAM, but their EU importers are, and those importers need verified embedded-emissions data for the goods. In practice this means UK exporters must calculate embedded emissions to the CBAM methodology and have them independently verified, or risk losing EU customers. Getting this right is now a commercial requirement, not just a compliance one.",
      },
      {
        title: "How we help",
        body: "We identify whether your goods are in scope, calculate embedded emissions to the required CBAM methodology, gather and structure the supplier and production data behind them, and prepare verification-ready, submission-ready reporting for the EU and UK schemes. For manufacturers, this connects directly to product carbon footprinting and Scope 3 work, so the same rigorous data serves more than one purpose.",
      },
    ],
    relatedLinks: [
      { href: "/product-carbon-footprinting", label: "Product Carbon Footprinting" },
      { href: "/scope-3", label: "Scope 3" },
      { href: "/regulations", label: "Regulations" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    slug: "nz-insights-pro",
    eyebrow: "Our Platform",
    title: "NZ Insights Pro",
    description:
      "NZ Insights Pro is Net Zero International's own carbon measurement and reporting platform. It measures and reports greenhouse gas emissions for multi-site and multi-country organisations across Scopes 1, 2 and 3, aligned to internationally recognised frameworks and emission-factor datasets, and models each organisation's path to net zero. Every figure it produces is reviewed and verified by our consultants, so you get the consistency of software with the accountability of experts.",
    metaDescription:
      "NZ Insights Pro is Net Zero International's proprietary platform for measuring and reporting emissions across multi-site, multi-country organisations, Scopes 1, 2 and 3, aligned to international frameworks, with audit-ready outputs.",
    ctaLabel: "Talk to us about your reporting",
    nextStepTitle: "See what your emissions data could look like.",
    nextStepDescription:
      "Whether you report across one site or many countries, we can measure, model and report your emissions on NZ Insights Pro, and give you a clear plan to reduce them.",
    sections: [
      {
        title: "What is NZ Insights Pro?",
        body: "NZ Insights Pro is a proprietary platform, built by Net Zero International over five years of hands-on client delivery, that measures, tracks and reports an organisation's carbon emissions in one place. It replaces the patchwork of spreadsheets and disconnected calculators most organisations rely on with a single, governed system, covering Scope 1, 2 and 3 emissions, reduction planning, and progress against net zero targets. Because it was built by practitioners doing the work, it reflects how carbon reporting actually has to stand up in procurement, compliance and audit.",
      },
      {
        title: "How do you measure and report emissions across multiple sites and countries?",
        body: "Multi-site, multi-country emissions reporting needs a single system that applies consistent methodology and the correct country-specific emission factors to each location, then consolidates them into one organisational total. NZ Insights Pro does exactly this: it captures data site by site and country by country, applies the right factors for each, and rolls everything up into a single, coherent view across Scopes 1, 2 and 3. Because emission factors and reporting boundaries differ by country and site, using one governed platform, rather than separate spreadsheets per location, is what keeps the consolidated figure consistent, comparable and defensible.",
      },
      {
        title: "Built on international frameworks and datasets",
        body: "NZ Insights Pro is developed under the frameworks that global reporting depends on, the GHG Protocol, GRI, and the ISSB Standards (IFRS S1 and IFRS S2), with product and life-cycle work aligned to ISO 14040/14044, ISO 14067, and the EPD standards (ISO 14025 and EN 15804). It draws on recognised international emission-factor datasets rather than generic estimates: UK DESNZ and DEFRA, US EPA USEEIO, Europe's FIGARO, the worldwide CEDA database, and country-specific datasets as they become available. That grounding means the numbers translate directly into the reports and disclosures your organisation actually has to file, wherever it operates.",
      },
      {
        title: "One platform, many disclosure regimes",
        body: "Because it is built on international frameworks and multi-country data, NZ Insights Pro supports reporting across the major global disclosure regimes from a single, consistent emissions dataset, including CSRD, EU ETS and UK ETS, CBAM, SECR and SDR across the UK and Europe, the US SEC climate disclosure rule and California's climate accountability package, Australia's ASRS, and Singapore's ACRA requirements. For multinational organisations, that means one measured source of truth feeding several jurisdictions' obligations, rather than a separate exercise for each.",
      },
      {
        title: "Trajectory modelling and milestone tracking",
        body: "Beyond measuring today's footprint, NZ Insights Pro models your reduction trajectory against your net zero targets and tracks progress over time. It shows where you are against plan, flags where you are drifting, and keeps milestones and actions visible, turning a static annual number into a live view of whether you are on course. That makes reporting a management tool, not just a compliance exercise.",
      },
      {
        title: "Audit-ready by design",
        body: "The platform produces audit-ready outputs: a documented methodology, traceable source data, consistent emission factors, and a clear record behind every figure. That is increasingly what procurement teams, assurance providers and regulators expect, for CBAM, CSRD and assured Scope 3 in particular, and it is exactly where spreadsheet-based reporting tends to fall down. With NZ Insights Pro, the evidence trail is built in, not reconstructed after the fact.",
      },
      {
        title: "Secure and enterprise-ready",
        body: "NZ Insights Pro is a secure, multi-tenant platform with organisation-level data isolation, multi-factor authentication, role-based access control, and GDPR-compliant data handling. Security and data protection are designed into the architecture, which matters for larger organisations, regulated sectors, and public-sector work.",
      },
      {
        title: "Software with expert accountability",
        body: "NZ Insights Pro is not a generic carbon calculator, and it is not a chatbot estimate. General-purpose tools can produce a rough number; they cannot stand behind it. What makes our reporting reliable is the combination of a purpose-built platform, verified data, and consultants who understand your organisation and are accountable for the result. The platform gives our team the visibility to work at scale without losing that accountability, which is why clients trust the numbers enough to put them in front of boards, auditors and procurement teams.",
      },
    ],
    relatedLinks: [
      { href: "/scope-3", label: "Scope 3" },
      { href: "/carbon-reduction-plans", label: "Carbon Reduction Plans" },
      { href: "/regulations", label: "Regulations" },
      { href: "/services", label: "Services" },
      { href: "/contact", label: "Contact" },
    ],
  },
];

export const resourcePages = [
  {
    slug: "glossary",
    eyebrow: "Glossary",
    title: "A glossary that makes the subject easier to navigate.",
    description:
      "Plain-English definitions for the Scope 1, 2 and 3 terms, baselines and reporting language you'll come across when working with us.",
  },
  {
    slug: "faq",
    eyebrow: "FAQ",
    title: "Answers to the questions clients ask most.",
    description:
      "Direct answers to the questions clients ask before starting a carbon reduction plan, Scope 3 project, or training programme.",
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
    term: "Carbon reduction plan",
    definition: "A documented plan showing how an organisation will reduce its emissions over time.",
  },
  {
    term: "Carbon accounting",
    definition: "The process of measuring and reporting greenhouse gas emissions using a recognised method.",
  },
  {
    term: "Baseline",
    definition: "The reference year or period used to measure progress over time.",
  },
];

export const buildPhases = [
  {
    title: "Understand",
    points: ["Initial discovery", "Review of reporting needs", "Sector and supplier context"],
  },
  {
    title: "Measure",
    points: ["Carbon data collection", "Scope 3 prioritisation", "Current-state reporting"],
  },
  {
    title: "Plan",
    points: ["Carbon reduction plan", "Strategy workshops", "Priority actions and timeline"],
  },
  {
    title: "Support",
    points: ["Training", "Supplier engagement", "Follow-up and implementation support"],
  },
];

export const faqs = [
  {
    q: "What does a carbon reduction plan include?",
    a: "A strong plan brings together a baseline emissions view, practical reduction actions, and evidence that can be used in procurement or governance settings.",
  },
  {
    q: "Can you help with Scope 3 emissions?",
    a: "Yes. We support category screening, supplier engagement, data collection, and the practical steps needed to make Scope 3 manageable.",
  },
  {
    q: "Do you offer CPD accredited training?",
    a: "Yes. Training is a core part of the offer and can be adapted for leadership, procurement, finance, operations, or mixed teams.",
  },
  {
    q: "Which organisations do you work with?",
    a: "We support private sector businesses, public sector suppliers, and organisations across sectors including manufacturing, construction, healthcare, logistics, and professional services.",
  },
];
