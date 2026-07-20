import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "nz-insights-pro");

export const metadata: Metadata = {
  title: "NZ Insights Pro | Multi-site carbon measurement & reporting platform",
  description: page?.metaDescription ?? page?.description,
};

export default function NzInsightsProPage() {
  return (
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
  );
}
