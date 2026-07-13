export default function sitemap() {
  const baseUrl = "https://netzero.international";
  const paths = [
    "",
    "/services",
    "/scope-3",
    "/workshops",
    "/training",
    "/regulations",
    "/glossary",
    "/faq",
    "/ai-era",
    "/resources",
    "/about",
    "/contact",
  ];

  return paths.map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: new Date(),
  }));
}
