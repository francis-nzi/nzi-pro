import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "product-carbon-footprinting");

export const metadata: Metadata = {
  title: "Product Carbon Footprinting (PCF) | ISO 14067",
  description: page?.metaDescription ?? page?.description,
};

export default function ProductCarbonFootprintingPage() {
  return (
    <ContentPage
      eyebrow={page?.eyebrow ?? "Product Carbon Footprinting"}
      title={page?.title ?? "Product carbon footprinting"}
      description={page?.description ?? ""}
      sections={page?.sections}
      ctaLabel={page?.ctaLabel ?? "Discuss product carbon footprinting"}
      nextStepTitle={page?.nextStepTitle}
      nextStepDescription={page?.nextStepDescription}
      relatedLinks={page?.relatedLinks}
    />
  );
}
