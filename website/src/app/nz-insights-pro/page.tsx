import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema, softwareApplicationSchema } from "@/lib/schema";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "nz-insights-pro");

export const metadata: Metadata = {
  title: "NZ Insights Pro | Multi-site carbon measurement & reporting platform",
  description: page?.metaDescription ?? page?.description,
  alternates: { canonical: "/nz-insights-pro" },
};

const breadcrumbs = breadcrumbSchema([{ name: "NZ Insights Pro", path: "/nz-insights-pro" }]);

export default function NzInsightsProPage() {
  return (
    <>
      <JsonLd data={softwareApplicationSchema} />
      <JsonLd data={breadcrumbs} />
      <ContentPage
        eyebrow={page?.eyebrow ?? "Our Platform"}
        title={page?.title ?? "NZ Insights Pro"}
        description={page?.description ?? ""}
        sections={page?.sections}
        ctaLabel={page?.ctaLabel ?? "Talk to us about your reporting"}
        nextStepTitle={page?.nextStepTitle}
        nextStepDescription={page?.nextStepDescription}
        relatedLinks={page?.relatedLinks}
      />
    </>
  );
}
