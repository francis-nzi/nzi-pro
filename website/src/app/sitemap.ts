import { comparisonPages } from "@/content/comparisons";

export default function sitemap() {
  const baseUrl = "https://netzero.international";
  const paths = [
    "",
    "/services",
    "/carbon-reduction-plans",
    "/scope-3",
    "/life-cycle-assessments",
    "/product-carbon-footprinting",
    "/cbam",
    "/nz-insights-pro",
    "/workshops",
    "/training",
    "/regulations",
    "/uk-srs-readiness",
    "/glossary",
    "/faq",
    "/ai-era",
    "/resources",
    ...comparisonPages.map((page) => `/resources/${page.slug}`),
    "/about",
    "/contact",
  ];

  return paths.map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: new Date(),
  }));
}
