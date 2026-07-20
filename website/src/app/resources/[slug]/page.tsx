import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SectionHeading } from "@/components/SectionHeading";
import { JsonLd } from "@/components/JsonLd";
import { ClosingCta } from "@/components/ClosingCta";
import { articleSchema, breadcrumbSchema, faqPageSchema } from "@/lib/schema";
import { comparisonPages } from "@/content/comparisons";

const PUBLISHED_DATE = "2026-07-20";

export function generateStaticParams() {
  return comparisonPages.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = comparisonPages.find((item) => item.slug === slug);
  if (!page) return {};
  return {
    title: page.titleTag,
    description: page.metaDescription,
    alternates: { canonical: `/resources/${page.slug}` },
  };
}

export default async function ComparisonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = comparisonPages.find((item) => item.slug === slug);
  if (!page) notFound();

  const article = articleSchema({
    headline: page.h1,
    path: `/resources/${page.slug}`,
    description: page.metaDescription,
    datePublished: PUBLISHED_DATE,
  });
  const faq = faqPageSchema(`/resources/${page.slug}`, [{ q: page.h1, a: page.answer }]);
  const breadcrumbs = breadcrumbSchema([
    { name: "Resources", path: "/resources" },
    { name: page.titleTag, path: `/resources/${page.slug}` },
  ]);

  return (
    <>
      <JsonLd data={article} />
      <JsonLd data={faq} />
      <JsonLd data={breadcrumbs} />
      <div className="site-wrap">
        <section className="page-hero">
          <p className="eyebrow">Resources</p>
          <h1>{page.h1}</h1>
          <p className="lead">{page.answer}</p>
        </section>

        <section className="content-section">
          <SectionHeading eyebrow="At a glance" title="Quick comparison" />
          <div className="page-layout">
            <article className="page-card">
              <ul className="stack-list">
                {page.atAGlance.map((item) => (
                  <li key={item.label}>
                    <strong>{item.label}</strong> &mdash; {item.text}
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section className="content-section">
          <SectionHeading eyebrow="In practice" title={page.bodyTitle} description={page.body} />
        </section>

        <ClosingCta ctaLabel={page.ctaLabel} ctaHref={page.ctaHref} relatedLinks={page.links} />
      </div>
    </>
  );
}
