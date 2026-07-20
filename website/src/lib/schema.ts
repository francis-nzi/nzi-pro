const BASE_URL = "https://netzero.international";

export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${BASE_URL}/#organization`,
  name: "Net Zero International",
  url: BASE_URL,
  logo: `${BASE_URL}/netzero-logo.png`,
  description:
    "UK carbon and sustainability consultancy helping organisations measure, report and reduce emissions through carbon accounting, carbon reduction plans, Scope 3 support, life cycle assessments, product carbon footprinting, CBAM reporting, workshops and CPD accredited training.",
  email: "info@netzero.international",
  areaServed: [
    { "@type": "Country", name: "United Kingdom" },
    { "@type": "Country", name: "Ireland" },
  ],
  knowsAbout: [
    "Carbon accounting",
    "Greenhouse gas reporting",
    "Scope 1 emissions",
    "Scope 2 emissions",
    "Scope 3 emissions",
    "Carbon reduction plans",
    "Life cycle assessment",
    "Product carbon footprinting",
    "Environmental Product Declarations (EPD)",
    "ISO 14025",
    "EN 15804",
    "ISO 14040",
    "ISO 14044",
    "ISO 14067",
    "CBAM",
    "Carbon Border Adjustment Mechanism",
    "GHG Protocol",
    "GRI Standards",
    "ISSB Standards",
    "IFRS S1",
    "IFRS S2",
    "CSRD",
    "EU ETS",
    "UK ETS",
    "SECR",
    "SDR",
    "US SEC climate disclosure rule",
    "California climate accountability package",
    "Australia ASRS",
    "Singapore ACRA sustainability reporting",
    "PPN 006",
    "NHS Evergreen",
    "Net Zero strategy",
  ],
  memberOf: {
    "@type": "Organization",
    name: "Carbon Accounting Alliance",
    url: "https://www.carbonaccountingalliance.com/member-directory",
  },
  owns: { "@id": `${BASE_URL}/#nz-insights-pro` },
  contactPoint: {
    "@type": "ContactPoint",
    email: "info@netzero.international",
    contactType: "sales",
    areaServed: "GB",
    availableLanguage: "English",
  },
  sameAs: [
    "https://www.linkedin.com/company/net-zero-international",
    "https://find-and-update.company-information.service.gov.uk/company/13587676",
    "https://www.cpduk.co.uk/providers/net-zero-international",
    "https://www.carbonaccountingalliance.com/member-directory",
  ],
};

export const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${BASE_URL}/#website`,
  url: BASE_URL,
  name: "Net Zero International",
  publisher: { "@id": `${BASE_URL}/#organization` },
  inLanguage: "en-GB",
};

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      ...items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 2,
        name: item.name,
        item: `${BASE_URL}${item.path}`,
      })),
    ],
  };
}

export function articleSchema(options: {
  headline: string;
  path: string;
  description: string;
  datePublished: string;
  dateModified?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: options.headline,
    description: options.description,
    url: `${BASE_URL}${options.path}`,
    datePublished: options.datePublished,
    dateModified: options.dateModified ?? options.datePublished,
    author: { "@id": `${BASE_URL}/#organization` },
    publisher: { "@id": `${BASE_URL}/#organization` },
  };
}

export function serviceSchema(options: {
  name: string;
  serviceType: string;
  path: string;
  description: string;
  areaServed?: string[];
}) {
  const countries = options.areaServed ?? ["United Kingdom", "Ireland"];
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: options.name,
    serviceType: options.serviceType,
    url: `${BASE_URL}${options.path}`,
    provider: { "@id": `${BASE_URL}/#organization` },
    areaServed:
      countries.length === 1
        ? { "@type": "Country", name: countries[0] }
        : countries.map((name) => ({ "@type": "Country", name })),
    description: options.description,
  };
}

export const courseSchema = {
  "@context": "https://schema.org",
  "@type": "Course",
  name: "CPD Accredited Net Zero and Carbon Accounting Training",
  url: `${BASE_URL}/training`,
  provider: { "@id": `${BASE_URL}/#organization` },
  description:
    "CPD accredited training that helps business leaders and teams understand carbon accounting, Net Zero strategy and the actions that matter most.",
  educationalCredentialAwarded: "CPD accredited",
  audience: {
    "@type": "EducationalAudience",
    educationalRole: "Leadership, procurement, finance and operations teams",
  },
  hasCourseInstance: {
    "@type": "CourseInstance",
    courseMode: ["Onsite", "Online"],
    courseWorkload: "Adaptable to team needs",
  },
};

export function faqPageSchema(path: string, faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url: `${BASE_URL}${path}`,
    mainEntity: faqs.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function definedTermSetSchema(terms: { term: string; definition: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    name: "Net Zero International Carbon Reporting Glossary",
    url: `${BASE_URL}/glossary`,
    hasDefinedTerm: terms.map((item) => ({
      "@type": "DefinedTerm",
      name: item.term,
      description: item.definition,
    })),
  };
}

export const softwareApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${BASE_URL}/#nz-insights-pro`,
  name: "NZ Insights Pro",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web-based",
  url: `${BASE_URL}/nz-insights-pro`,
  publisher: { "@id": `${BASE_URL}/#organization` },
  author: { "@id": `${BASE_URL}/#organization` },
  description:
    "NZ Insights Pro is Net Zero International's proprietary carbon measurement and reporting platform, developed over five years of client delivery. It measures and reports greenhouse gas emissions for multi-site and multi-country organisations across Scopes 1, 2 and 3, developed under the GHG Protocol, GRI and ISSB Standards (IFRS S1 and IFRS S2), using international emission-factor datasets (UK DESNZ and DEFRA, US EPA USEEIO, Europe FIGARO, worldwide CEDA, and country-specific datasets). It supports major global disclosure regimes including CSRD, EU ETS, UK ETS, CBAM, SECR, SDR, the US SEC climate rule, California's climate accountability package, Australia's ASRS and Singapore's ACRA requirements, models reduction trajectories against net zero targets, and produces audit-ready outputs. It is a secure, multi-tenant system with multi-factor authentication, role-based access control and GDPR-compliant data handling, backed by expert consultant review.",
  featureList: [
    "Multi-site and multi-country emissions measurement",
    "Scope 1, 2 and 3 carbon accounting",
    "Developed under GHG Protocol, GRI and ISSB Standards (IFRS S1 and IFRS S2)",
    "International emission-factor datasets: UK DESNZ/DEFRA, US EPA USEEIO, Europe FIGARO, worldwide CEDA, plus country-specific datasets",
    "Supports global disclosure regimes: CSRD, EU ETS, UK ETS, CBAM, SECR, SDR, US SEC climate rule, California climate accountability package, Australia ASRS, Singapore ACRA",
    "Net zero trajectory modelling and milestone tracking",
    "Audit-ready reporting outputs",
    "Multi-tenant architecture with organisation-level data isolation",
    "Multi-factor authentication, role-based access control, GDPR-compliant data handling",
    "Expert consultant review and verification",
  ],
  keywords:
    "carbon accounting software, emissions measurement platform, multi-site carbon reporting, multi-country emissions, Scope 3 reporting, ISSB IFRS S2 reporting, CSRD reporting software, multi-jurisdiction climate disclosure, net zero trajectory modelling, audit-ready carbon data",
};
